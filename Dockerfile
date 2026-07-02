FROM python:3.12-slim

# Install system dependencies including Node.js, npm, curl, and build-essential
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy python dependencies and install them
COPY python-service/requirements.txt ./python-service/
RUN pip install --no-cache-dir -r python-service/requirements.txt

# Copy package files and install node dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the frontend (TanStack Start)
RUN npm run build

# Expose the default port (Render will configure PORT dynamically)
EXPOSE 3000

# Make the start script executable
RUN chmod +x start-prod.sh

CMD ["./start-prod.sh"]
