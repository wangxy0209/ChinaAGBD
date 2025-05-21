# ****************************************************
# Part-3: Merge all tiles using R
# ****************************************************

# ****************************************************
# When the study area is small and the number of tiles is limited
# ****************************************************

library(raster)

# Set folder path
folder_path <- "D:\\Biomass\\AgbdGrid30\\AGBD508\\"

# Read all TIFF files in the folder
tiff_files <- list.files(folder_path, pattern = "\\.tif$", full.names = TRUE)

rasters <- list()

# Iteratively read TIFF files
for (file in tiff_files) {
  r <- raster(file)
  rasters[[length(rasters) + 1]] <- r
}

# Merge all RasterLayers
merged_raster <- do.call(merge, rasters)

# Save the merged RasterLayer as a new TIFF file
plot(merged_raster)
writeRaster(merged_raster, filename="D:\\Biomass\\AgbdGrid30\\merge.tif")

# ****************************************************
# When the study area is large and the number of tiles is high
# ****************************************************

library(terra)

# 📁 Set input and output paths
folder_path <- "D:/Biomass/AgbdGrid30/AGBD508/"
output_path <- "D:/Biomass/AgbdGrid30/temp_merged/"
final_output <- "D:/Biomass/AgbdGrid30/merged_final.tif"
batch_size <- 50

if (!dir.exists(output_path)) {
  dir.create(output_path)
}

# 🔢 Retrieve files and sort them in the order of Tile_<number>_AGBD
tif_files <- list.files(folder_path, pattern = "\\.tif$", full.names = TRUE)
extract_number <- function(x) {
  as.numeric(gsub(".*Tile_(\\d+)_AGBD.*", "\\1", basename(x)))
}
sorted_tif_files <- tif_files[order(sapply(tif_files, extract_number))]

# Batch-wise
batches <- split(sorted_tif_files, ceiling(seq_along(sorted_tif_files) / batch_size))

# 🧩 Merge by batch
intermediate_files <- c()
for (i in seq_along(batches)) {
  cat(sprintf("🧩 Currently merging batch %d out of %d...\n", i, length(batches)))
  
  rasters <- lapply(batches[[i]], rast)
  merged <- do.call(mosaic, rasters)
  
  batch_outfile <- file.path(output_path, sprintf("merged_batch_%03d.tif", i))
  writeRaster(merged, batch_outfile, overwrite = TRUE)
  intermediate_files <- c(intermediate_files, batch_outfile)
}

# 🔗 Merge all batches
cat("🔗 Merge all intermediate batch results...\n")
merged_list <- lapply(intermediate_files, rast)
final_merged <- do.call(mosaic, merged_list)

plot(final_merged)

# 💾 save merged files
cat("💾 Writing final merged results...\n")
writeRaster(final_merged, final_output, overwrite = TRUE)

cat("✅ Finished! Exported file:", final_output, "\n")

# Copyright (c) 2025 wangxy0209.
# This work is licensed under the terms of the MIT license.  
# For a copy, see https://opensource.org/licenses/MIT
