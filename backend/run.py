import os
import uvicorn

if __name__ == "__main__":
    # Bind to localhost by default. Set API_HOST=0.0.0.0 to serve other machines on the network.
    uvicorn.run("app.main:app", host=os.getenv("API_HOST", "127.0.0.1"), port=int(os.getenv("API_PORT", "8000")), reload=False)
