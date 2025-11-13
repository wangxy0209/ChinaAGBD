# ChinaAGBD
China Biomass Dataset for 2020

This repository provides a modular pipeline for large-scale aboveground biomass (AGB) estimation using Google Earth Engine (GEE) and local adaptive Random Forest (RF) models. The workflow is divided into four key stages:

---

## 🔹 1. Region Grid Splitting (`1GridSplit.js`)

To facilitate localized modeling over a large study area, the region of interest (ROI) is divided into an `n × m` grid using this script. Each grid tile will be independently processed, allowing for the training of locally adaptive RF models within each tile.

---

## 🔹 2. EO Data Preparation (`2PreData.js`)

This step downloads freely available Earth Observation (EO) datasets to GEE Assets, including:

* **Sentinel-2** surface reflectance data
* **PALSAR** backscatter data
* **GLO-30 DEM** (Global Digital Elevation Model)
* **GEDI** LiDAR-derived biomass and canopy structure data

Note: We separate data preparation from model training due to GEE memory and compute limitations, which may cause runtime failures for large-scale operations.

---

## 🔹 3. Model Training and Prediction (`3RegModel.js`)

In this stage, a Random Forest model is trained for each grid tile using the prepared EO data. The trained models are then used to generate continuous AGB prediction maps, which are exported to Google Drive and can be subsequently downloaded for local post-processing.

---

## 🔹 4. Merging and Masking (`4MergeTiles.R`)

After downloading all predicted grid tiles locally, this R script merges them into a single mosaic map. Optionally, users can apply a land cover mask using any available land cover product (customizable), to extract vegetation types of interest.

A national biomass product for all vegetation types in China for the year 2020 is freely available via the provided link. This product is stored as a 30-meter resolution GeoTIFF file and provides AGB values in units of megagrams per hectare (Mg ha⁻¹).

---

## 🔁 Extension

This framework can be extended to produce biomass maps for different time periods or geographic regions. It can also be adapted to generate other ecological variables such as:

* **Tree height**
* **Chlorophyll content**
* **Other vegetation biophysical parameters**

To do so, simply replace the predictor variables in the model with relevant EO data and ensure sufficient in-situ training samples are available.

---

## 📁 Folder Structure

```text
├── 1GridSplit.js       # Splits study area into n×m tiles
├── 2PreData.js         # Downloads EO data to GEE Asset
├── 3RegModel.js        # Trains RF models and predicts AGB
├── 4MergeTiles.R       # Merges downloaded tiles into full map
└── README.md           # Project documentation
```

---

## 📌 Requirements

* Google Earth Engine account with access to Asset storage and Google Drive
* R environment with raster/spatial packages (for merging)

---

## 📝 Citation

If you use this code or pipeline in your research, please cite appropriately or reference this repository.

@article{Wang2025_AGBChina30m,
  author    = {Wang, X. and Zhong, B. and Chang, B. and Zhang, Y. and Li, S. and Du, B. and Qiao, Y. and Cai, H. and Wu, J. and Yang, A. and Jian, Y. and Su, J. and Wang, G. and Liu, Q.},
  title     = {A 30 m aboveground biomass dataset for multiple vegetation types in China (2020)},
  journal   = {Scientific Data},
  volume    = {12},
  number    = {1},
  pages     = {1777},
  year      = {2025},
  doi       = {10.1038/s41597-025-06053-x},
  url       = {https://doi.org/10.1038/s41597-025-06053-x}
}

---
