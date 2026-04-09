"""
pipeline package — Auto-Run pipeline orchestrator.

Usage in launcher.py:
    from pipeline import router as pipeline_router
    app.include_router(pipeline_router, prefix="/launcher")
"""

from pipeline.routes import router

__all__ = ["router"]
