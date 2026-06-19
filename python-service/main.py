"""
Paperflow Dataset Studio — Python preprocessing microservice.

Provides advanced preprocessing (SMOTE, polynomial features, robust scaling,
scikit-learn encoders) that can't run inside the Cloudflare Worker that hosts
the Paperflow web app.

Endpoints
---------
GET  /health
POST /transform      JSON: {"csv": "<csv string>", "steps": [...]}
POST /augment        JSON: {"csv": "<csv string>", "method": "smote"|"random_over"|"random_under", "target": "col", "options": {...}}

Auth: bearer token via `PAPERFLOW_PY_TOKEN` env var (matches the secret
configured in Lovable Cloud as PAPERFLOW_PY_SERVICE_TOKEN).
"""
from __future__ import annotations

import io
import os
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sklearn.preprocessing import (
    LabelEncoder, MinMaxScaler, OneHotEncoder, PolynomialFeatures, RobustScaler, StandardScaler,
)

TOKEN = os.environ.get("PAPERFLOW_PY_TOKEN", "")

app = FastAPI(title="Paperflow Dataset Studio", version="1.0")

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



def require_token(authorization: str | None = Header(default=None)) -> None:
    if not TOKEN:
        return  # dev mode
    if not authorization or not authorization.startswith("Bearer ") or authorization.split(" ", 1)[1] != TOKEN:
        raise HTTPException(401, "Unauthorized")


# ---------- Schemas ----------
class Step(BaseModel):
    kind: Literal[
        "label_encode", "one_hot_encode",
        "standard_scale", "minmax_scale", "robust_scale",
        "polynomial_features", "log_transform", "binning",
        "variance_threshold", "correlation_drop",
    ]
    columns: list[str] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)


class TransformRequest(BaseModel):
    csv: str
    steps: list[Step]


class AugmentRequest(BaseModel):
    csv: str
    method: Literal["smote", "random_over", "random_under"]
    target: str
    options: dict[str, Any] = Field(default_factory=dict)


# ---------- Helpers ----------
def _df(csv: str) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(csv))


def _csv(df: pd.DataFrame) -> str:
    out = io.StringIO()
    df.to_csv(out, index=False)
    return out.getvalue()


# ---------- Endpoints ----------
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/transform", dependencies=[Depends(require_token)])
def transform(req: TransformRequest) -> dict[str, Any]:
    try:
        df = _df(req.csv)
        log: list[str] = []

        for step in req.steps:
            cols = step.columns or list(df.columns)
            if step.kind == "label_encode":
                for c in cols:
                    if c not in df: continue
                    df[c] = LabelEncoder().fit_transform(df[c].astype(str))
                log.append(f"label_encode: {cols}")
            elif step.kind == "one_hot_encode":
                enc = OneHotEncoder(sparse_output=False, handle_unknown="ignore")
                arr = enc.fit_transform(df[cols].astype(str))
                new_cols = enc.get_feature_names_out(cols)
                df = pd.concat(
                    [df.drop(columns=cols), pd.DataFrame(arr, columns=new_cols, index=df.index)],
                    axis=1,
                )
                log.append(f"one_hot_encode: {cols} -> {len(new_cols)} columns")
            elif step.kind in {"standard_scale", "minmax_scale", "robust_scale"}:
                # Ensure all selected columns are numeric
                non_numeric = [c for c in cols if c in df and not pd.api.types.is_numeric_dtype(df[c])]
                if non_numeric:
                    raise ValueError(f"Scaling requires numeric columns. Non-numeric columns selected: {non_numeric}")
                # Check for NaNs
                has_nans = [c for c in cols if c in df and df[c].isna().any()]
                if has_nans:
                    raise ValueError(f"Scaling requires columns without missing values. Clean missing values first in: {has_nans}")

                scaler = {"standard_scale": StandardScaler, "minmax_scale": MinMaxScaler, "robust_scale": RobustScaler}[step.kind]()
                df[cols] = scaler.fit_transform(df[cols])
                log.append(f"{step.kind}: {cols}")
            elif step.kind == "polynomial_features":
                # Ensure all selected columns are numeric
                non_numeric = [c for c in cols if c in df and not pd.api.types.is_numeric_dtype(df[c])]
                if non_numeric:
                    raise ValueError(f"Polynomial features require numeric columns. Non-numeric: {non_numeric}")

                degree = int(step.options.get("degree", 2))
                pf = PolynomialFeatures(degree=degree, include_bias=False)
                arr = pf.fit_transform(df[cols])
                new_cols = pf.get_feature_names_out(cols)
                df = pd.concat(
                    [df.drop(columns=cols), pd.DataFrame(arr, columns=new_cols, index=df.index)],
                    axis=1,
                )
                log.append(f"polynomial_features (deg={degree}): {cols}")
            elif step.kind == "log_transform":
                # Ensure all selected columns are numeric
                non_numeric = [c for c in cols if c in df and not pd.api.types.is_numeric_dtype(df[c])]
                if non_numeric:
                    raise ValueError(f"Log transformation requires numeric columns. Non-numeric: {non_numeric}")

                for c in cols:
                    df[c] = np.log1p(df[c].clip(lower=0))
                log.append(f"log_transform: {cols}")
            elif step.kind == "binning":
                # Ensure all selected columns are numeric
                non_numeric = [c for c in cols if c in df and not pd.api.types.is_numeric_dtype(df[c])]
                if non_numeric:
                    raise ValueError(f"Binning requires numeric columns. Non-numeric: {non_numeric}")

                bins = int(step.options.get("bins", 5))
                for c in cols:
                    df[c] = pd.cut(df[c], bins=bins, labels=False, include_lowest=True)
                log.append(f"binning ({bins} bins): {cols}")
            elif step.kind == "variance_threshold":
                from sklearn.feature_selection import VarianceThreshold
                thresh = float(step.options.get("threshold", 0.0))
                num = df.select_dtypes(include=[np.number])
                if num.empty:
                    raise ValueError("No numeric columns available for Variance Threshold.")
                vt = VarianceThreshold(threshold=thresh)
                vt.fit(num)
                keep = num.columns[vt.get_support()]
                drop = [c for c in num.columns if c not in keep]
                df = df.drop(columns=drop)
                log.append(f"variance_threshold ({thresh}): dropped {drop}")
            elif step.kind == "correlation_drop":
                thresh = float(step.options.get("threshold", 0.95))
                num = df.select_dtypes(include=[np.number])
                if num.empty:
                    raise ValueError("No numeric columns available for Correlation Drop.")
                corr = num.corr().abs()
                upper = corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool))
                drop = [c for c in upper.columns if any(upper[c] > thresh)]
                df = df.drop(columns=drop)
                log.append(f"correlation_drop ({thresh}): dropped {drop}")

        return {"csv": _csv(df), "rows": int(len(df)), "columns": int(len(df.columns)), "log": log}
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))



@app.post("/augment", dependencies=[Depends(require_token)])
def augment(req: AugmentRequest) -> dict[str, Any]:
    try:
        df = _df(req.csv)
        if req.target not in df.columns:
            raise ValueError(f"Target column '{req.target}' not found in the dataset.")

        y = df[req.target]
        X = df.drop(columns=[req.target])

        # Check for missing values in X/y
        if df.isna().any().any():
            raise ValueError("Class balancing requires no missing values in the dataset. Clean missing values first.")

        before = y.value_counts().to_dict()

        if req.method == "smote":
            from imblearn.over_sampling import SMOTE
            sm = SMOTE(random_state=int(req.options.get("random_state", 42)))
            # Imblearn SMOTE only supports numeric columns for over-sampling features
            num_X = X.select_dtypes(include=[np.number])
            if num_X.empty:
                raise ValueError("SMOTE requires at least some numeric columns to perform over-sampling.")
            X_res, y_res = sm.fit_resample(num_X, y)
        elif req.method == "random_over":
            from imblearn.over_sampling import RandomOverSampler
            X_res, y_res = RandomOverSampler(random_state=42).fit_resample(X, y)
        elif req.method == "random_under":
            from imblearn.under_sampling import RandomUnderSampler
            X_res, y_res = RandomUnderSampler(random_state=42).fit_resample(X, y)
        else:
            raise ValueError("Unknown balancing method")

        out = pd.concat([pd.DataFrame(X_res), pd.Series(y_res, name=req.target)], axis=1)
        after = pd.Series(y_res).value_counts().to_dict()
        return {
            "csv": _csv(out),
            "rows": int(len(out)),
            "before": {str(k): int(v) for k, v in before.items()},
            "after": {str(k): int(v) for k, v in after.items()},
        }
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))

