# Use official Python image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements first for caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your code
COPY . .

# Expose port 8080 for Fly.io
EXPOSE 8080

# Run the app using gunicorn for production.
# Single worker (-w 1) because rooms are kept in memory and must be shared
# across all connected players; threads handle Socket.IO long-polling.
CMD ["gunicorn", "-w", "1", "--threads", "100", "--worker-class", "gthread", "-b", "0.0.0.0:8080", "app:app"]
