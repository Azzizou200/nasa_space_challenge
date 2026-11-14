"""
FastAPI Server for Universal SAR Environmental Change Detection
Serves the live pipeline endpoint for dynamic web applications.

Usage:
  python server.py
  (Runs on http://localhost:8000)
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Optional
from pipeline import analyze_forest_region

app = FastAPI(
    title="NASA SAR Forest Change Detection API",
    description="Universal Sentinel-1 SAR pipeline: takes any BBox and Year, detects illegal logging, and calculates dissipation speeds.",
    version="1.0.0"
)

# Enable CORS for all frontends (React, Vue, Vite, Next.js, plain HTML)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated data folder statically (so frontend can load images via URL)
os.makedirs("data", exist_ok=True)
app.mount("/data", StaticFiles(directory="data"), name="data")


class AnalyzeRequest(BaseModel):
    bbox: List[float] = Field(
        ...,
        description="[min_lon, min_lat, max_lon, max_lat]",
        example=[-63.35, -9.85, -62.85, -9.35]
    )
    year: int = Field(default=2025, description="Target observation year", example=2025)
    region_name: Optional[str] = Field(default="custom_region", description="Optional region name tag")


@app.get("/")
def health_check():
    return {
        "status": "online",
        "service": "NASA SAR Forest Change Detection API",
        "docs": "http://localhost:8000/docs"
    }


@app.post("/api/analyze")
def run_analysis(req: AnalyzeRequest):
    """
    Accepts any bounding box and year, runs the Sentinel-1 SAR pipeline,
    and returns monthly canopy stats, logging dissipation speeds, and image URLs.
    """
    if len(req.bbox) != 4:
        raise HTTPException(status_code=400, detail="bbox must contain exactly 4 coordinates: [min_lon, min_lat, max_lon, max_lat]")
        
    try:
        results = analyze_forest_region(
            bbox=req.bbox,
            year=req.year,
            region_name=req.region_name
        )
        
        # Add public image URLs to series
        for item in results.get("monthly_series", []):
            item["image_url"] = f"/data/{req.region_name}/{item['image']}"
            
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    print("Starting NASA SAR API server on http://localhost:8000...")
    print("Swagger interactive docs available at: http://localhost:8000/docs")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
