"""
Store Demand Forecasting — REST API Server
Flask backend with API key authentication.
"""

import os
import secrets
import functools
import json
from datetime import datetime

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

# ---------------------------------------------------------------------------
# App Configuration
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "src", "data")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR)
CORS(app)

# Generate a secure API key on each startup
API_KEY = secrets.token_urlsafe(32)

# ---------------------------------------------------------------------------
# Data Loading (runs once at startup)
# ---------------------------------------------------------------------------

print("\n[*] Loading data...")
train_df = pd.read_csv(os.path.join(DATA_DIR, "train.csv"), parse_dates=["date"])
test_df = pd.read_csv(os.path.join(DATA_DIR, "test.csv"), parse_dates=["date"])
print(f"[OK] Loaded train ({train_df.shape[0]:,} rows) and test ({test_df.shape[0]:,} rows)")

# ---------------------------------------------------------------------------
# Pre-compute aggregations
# ---------------------------------------------------------------------------

print("[*] Pre-computing aggregations...")

# Overview KPIs
overview_data = {
    "total_stores": int(train_df["store"].nunique()),
    "total_items": int(train_df["item"].nunique()),
    "total_records": int(len(train_df)),
    "date_min": train_df["date"].min().strftime("%Y-%m-%d"),
    "date_max": train_df["date"].max().strftime("%Y-%m-%d"),
    "total_sales": float(train_df["sales"].sum()),
    "avg_daily_sales": float(train_df["sales"].mean()),
    "max_daily_sales": int(train_df["sales"].max()),
    "min_daily_sales": int(train_df["sales"].min()),
    "median_daily_sales": float(train_df["sales"].median()),
    "std_daily_sales": float(train_df["sales"].std()),
    "forecast_records": int(len(test_df)),
    "forecast_date_min": test_df["date"].min().strftime("%Y-%m-%d"),
    "forecast_date_max": test_df["date"].max().strftime("%Y-%m-%d"),
}

# Sales by store
sales_by_store = (
    train_df.groupby("store")["sales"]
    .agg(["sum", "mean", "std"])
    .reset_index()
    .rename(columns={"sum": "total_sales", "mean": "avg_sales", "std": "std_sales"})
)
sales_by_store_data = sales_by_store.to_dict(orient="records")
for r in sales_by_store_data:
    r["total_sales"] = float(r["total_sales"])
    r["avg_sales"] = round(float(r["avg_sales"]), 2)
    r["std_sales"] = round(float(r["std_sales"]), 2)
    r["store"] = int(r["store"])

# Monthly aggregation
train_df["year_month"] = train_df["date"].dt.to_period("M").astype(str)
monthly_all = (
    train_df.groupby(["year_month", "store"])["sales"]
    .sum()
    .reset_index()
    .rename(columns={"sales": "total_sales"})
)

# Daily trend (all stores combined)
daily_trend = (
    train_df.groupby("date")["sales"]
    .sum()
    .reset_index()
)
# Resample to weekly for a cleaner trend
daily_trend.set_index("date", inplace=True)
weekly_trend = daily_trend.resample("W").sum().reset_index()
weekly_trend["date_str"] = weekly_trend["date"].dt.strftime("%Y-%m-%d")

# Sales by item (all stores)
sales_by_item_all = (
    train_df.groupby("item")["sales"]
    .agg(["sum", "mean"])
    .reset_index()
    .rename(columns={"sum": "total_sales", "mean": "avg_sales"})
)

# Top items
top_items = sales_by_item_all.nlargest(10, "total_sales")

# Store list & Item list
store_list = sorted(train_df["store"].unique().tolist())
item_list = sorted(train_df["item"].unique().tolist())

# Pre-compute per-store monthly sales
store_monthly_cache = {}
for s in store_list:
    store_data = monthly_all[monthly_all["store"] == s].copy()
    store_data["total_sales"] = store_data["total_sales"].astype(float)
    store_monthly_cache[s] = store_data[["year_month", "total_sales"]].to_dict(orient="records")

# Pre-compute per-store item breakdown
store_item_cache = {}
for s in store_list:
    item_data = (
        train_df[train_df["store"] == s]
        .groupby("item")["sales"]
        .agg(["sum", "mean"])
        .reset_index()
        .rename(columns={"sum": "total_sales", "mean": "avg_sales"})
        .sort_values("total_sales", ascending=False)
    )
    item_data["total_sales"] = item_data["total_sales"].astype(float).round(0)
    item_data["avg_sales"] = item_data["avg_sales"].astype(float).round(2)
    item_data["item"] = item_data["item"].astype(int)
    store_item_cache[s] = item_data.to_dict(orient="records")

# Year-over-year data
train_df["year"] = train_df["date"].dt.year
train_df["month"] = train_df["date"].dt.month
yoy_data = (
    train_df.groupby(["year", "month"])["sales"]
    .sum()
    .reset_index()
    .rename(columns={"sales": "total_sales"})
)
yoy_data["year"] = yoy_data["year"].astype(int)
yoy_data["month"] = yoy_data["month"].astype(int)
yoy_data["total_sales"] = yoy_data["total_sales"].astype(float).round(0)

# Day of week pattern
train_df["day_of_week"] = train_df["date"].dt.day_name()
dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
dow_data = (
    train_df.groupby("day_of_week")["sales"]
    .mean()
    .reindex(dow_order)
    .reset_index()
    .rename(columns={"sales": "avg_sales"})
)
dow_data["avg_sales"] = dow_data["avg_sales"].astype(float).round(2)

print("[OK] Aggregations ready!")
print(f"\n{'='*55}")
print(f"  API KEY: {API_KEY}")
print(f"{'='*55}")
print(f"  Dashboard: http://localhost:5000")
print(f"{'='*55}\n")

# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

def require_api_key(f):
    """Decorator that checks X-API-Key header."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get("X-API-Key", "")
        if key != API_KEY:
            return jsonify({"error": "Unauthorized – invalid or missing API key"}), 401
        return f(*args, **kwargs)
    return decorated

# ---------------------------------------------------------------------------
# Frontend routes
# ---------------------------------------------------------------------------

@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory(FRONTEND_DIR, path)

# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.route("/api/overview")
@require_api_key
def api_overview():
    return jsonify(overview_data)


@app.route("/api/stores")
@require_api_key
def api_stores():
    return jsonify({"stores": store_list})


@app.route("/api/items")
@require_api_key
def api_items():
    return jsonify({"items": item_list})


@app.route("/api/sales/by-store")
@require_api_key
def api_sales_by_store():
    return jsonify({"data": sales_by_store_data})


@app.route("/api/sales/by-item")
@require_api_key
def api_sales_by_item():
    store = request.args.get("store", type=int)
    if store and store in store_item_cache:
        return jsonify({"store": store, "data": store_item_cache[store]})
    # All stores
    data = sales_by_item_all.copy()
    data["total_sales"] = data["total_sales"].astype(float).round(0)
    data["avg_sales"] = data["avg_sales"].astype(float).round(2)
    data["item"] = data["item"].astype(int)
    return jsonify({"store": "all", "data": data.to_dict(orient="records")})


@app.route("/api/sales/monthly")
@require_api_key
def api_sales_monthly():
    store = request.args.get("store", type=int)
    if store and store in store_monthly_cache:
        return jsonify({"store": store, "data": store_monthly_cache[store]})
    # All stores combined
    combined = monthly_all.groupby("year_month")["total_sales"].sum().reset_index()
    combined["total_sales"] = combined["total_sales"].astype(float).round(0)
    return jsonify({"store": "all", "data": combined.to_dict(orient="records")})


@app.route("/api/sales/trend")
@require_api_key
def api_sales_trend():
    return jsonify({
        "interval": "weekly",
        "data": [
            {"date": row["date_str"], "sales": float(row["sales"])}
            for _, row in weekly_trend.iterrows()
        ]
    })


@app.route("/api/sales/history")
@require_api_key
def api_sales_history():
    store = request.args.get("store", type=int)
    item = request.args.get("item", type=int)
    if not store or not item:
        return jsonify({"error": "store and item parameters required"}), 400

    mask = (train_df["store"] == store) & (train_df["item"] == item)
    subset = train_df.loc[mask, ["date", "sales"]].sort_values("date")
    # Downsample to weekly for performance
    subset = subset.set_index("date").resample("W").mean().reset_index()
    subset["date_str"] = subset["date"].dt.strftime("%Y-%m-%d")

    return jsonify({
        "store": store,
        "item": item,
        "data": [
            {"date": row["date_str"], "sales": round(float(row["sales"]), 2)}
            for _, row in subset.iterrows()
        ]
    })


@app.route("/api/sales/yoy")
@require_api_key
def api_sales_yoy():
    return jsonify({"data": yoy_data.to_dict(orient="records")})


@app.route("/api/sales/day-of-week")
@require_api_key
def api_sales_dow():
    return jsonify({"data": dow_data.to_dict(orient="records")})


@app.route("/api/sales/top-items")
@require_api_key
def api_top_items():
    data = top_items.copy()
    data["total_sales"] = data["total_sales"].astype(float).round(0)
    data["avg_sales"] = data["avg_sales"].astype(float).round(2)
    data["item"] = data["item"].astype(int)
    return jsonify({"data": data.to_dict(orient="records")})


@app.route("/api/model/info")
@require_api_key
def api_model_info():
    return jsonify({
        "model_type": "LightGBM",
        "metric": "MAE + SMAPE",
        "validation_smape": 13.64,
        "best_iteration": 2000,
        "parameters": {
            "num_leaves": 10,
            "learning_rate": 0.02,
            "feature_fraction": 0.8,
            "max_depth": 5,
            "num_boost_round": 2000,
        },
        "features": [
            "Lag features (91–728 days)",
            "Rolling mean features (365, 546, 730 days)",
            "EWM features (6 alphas × 9 lags)",
            "Date features (month, day, weekday, etc.)",
            "One-hot encoded day_of_week & month",
        ],
    })

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=False, port=5000, host="0.0.0.0")
