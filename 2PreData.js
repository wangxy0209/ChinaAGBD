// Script to estimate Above-Ground Biomass (AGB) using
// a Random Forest Regression model with 
// GEDI L4A Raster Aboveground Biomass Density observations.
var roi = ee.FeatureCollection("projects/ee-wangxy0209/assets/china");
// ****************************************************
// Part-1: Preprocessing and Data Preperation
// ****************************************************

// Select a region
// ****************************************************
// Delete the 'roi' import and draw a polygon
// for your region of interest

//!!! Due to the 250 GB storage limitation of GEE Assets,
//!!! the EO data for large-scale study areas must be exported in separate roi
Map.addLayer(roi);

// Select the datasets
// ****************************************************
// GEDI L4A Raster Aboveground Biomass Density
// These are point observations that will be used as ground-truth
// and the predicted variable in the regression model
var gedi = ee.ImageCollection('LARSE/GEDI/GEDI04_A_002_MONTHLY');
// We will use Sentinel-2 bands, derived indices and elevation
// as predictors for the regresison model

// Sentinel-2 Surface Reflectance 
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

// Copernicus GLO-30 DEM
var glo30 = ee.ImageCollection('COPERNICUS/DEM/GLO30');

// Select a time-period
// ****************************************************
var startDate = ee.Date.fromYMD(2020, 1, 1);
var endDate = startDate.advance(1, 'year');

// Preparing Sentinel-2 composite
// ****************************************************
var filteredS2 = s2
  .filter(ee.Filter.date(startDate, endDate))
  .filter(ee.Filter.bounds(roi))

// Extract the projection before any processing
var s2Projection = ee.Image(filteredS2.first()).select('B4')
  .projection();
// Function to apply scale factor to convert
// pixel values to reflectances
var scaleBands = function(image) {
  return image.multiply(0.0001)
    .copyProperties(image, ['system:time_start']);
};

// Use Cloud Score+ cloud mask
var csPlus = ee.ImageCollection(
    'GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
var csPlusBands = csPlus.first().bandNames();

// Function to mask pixels with low CS+ QA scores.
function maskLowQA(image) {
  var qaBand = 'cs';
  var clearThreshold = 0.5;
  var mask = image.select(qaBand).gte(clearThreshold);
  return image.updateMask(mask);
}

// Function to compute spectral indices
var addIndices = function(image) {
  var ndvi = image.normalizedDifference(['B8', 'B4'])
    .rename('ndvi');

  var mndwi = image.normalizedDifference(['B3', 'B11'])
    .rename('mndwi'); 

  var ndbi = image.normalizedDifference(['B11', 'B8'])
    .rename('ndbi');

  var evi = image.expression(
    '2.5 * ((NIR - RED)/(NIR + 6*RED - 7.5*BLUE + 1))', {
      'NIR': image.select('B8'),
      'RED': image.select('B4'),
      'BLUE': image.select('B2')
    }).rename('evi');

  var bsi = image.expression(
      '(( X + Y ) - (A + B)) /(( X + Y ) + (A + B)) ', {
        'X': image.select('B11'),
        'Y': image.select('B4'),
        'A': image.select('B8'),
        'B': image.select('B2'),
    }).rename('bsi');
  
  return image
    .addBands(ndvi)
    .addBands(mndwi)
    .addBands(ndbi)
    .addBands(evi)
    .addBands(bsi);
};

// We need to add Cloud Score + bands to each Sentinel-2
// image in the collection
// This is done using the linkCollection() function
var filteredS2WithCs = filteredS2.linkCollection(
    csPlus, csPlusBands);
// Apply all the pre-processing steps

// Order in which the functions are applied is important
var s2Processed = filteredS2WithCs
  .map(maskLowQA)
  .select('B.*')
  .map(scaleBands)
  .map(addIndices);

// Create the S2 composite
var s2Composite = s2Processed.median()
  .setDefaultProjection(s2Projection);
  
//Preparing PALSAR composite
// ****************************************************

var filtered = ee.ImageCollection('JAXA/ALOS/PALSAR/YEARLY/SAR_EPOCH')
                  .filter(ee.Filter.date('2020-01-01', '2021-02-01'))
                  .filterBounds(roi)
                  .select('H.');
                  // .mosaic();
                  // .clip(roi);
var sarHhVis = {
  min: -25.0,
  max: 5.0,
};
  
// Mean is preferred for SAR data
var sarfiltered = filtered.mean().setDefaultProjection(s2Projection).clip(roi);

var dnToDb = function powerToDb(img){
  var dbImage = img.expression(
    '10 * log10(DN * DN) - 83', {
    'DN': img  // origin DN value
    });
  return dbImage;
}

var PALSARComposite = dnToDb(sarfiltered);

// Add HH/HV ratio band
var hh_hv_ratio = PALSARComposite.expression(
  'HH_dB/HV_dB', {
    'HH_dB': PALSARComposite.select('HH'),
    'HV_dB': PALSARComposite.select('HV')
}).rename('HH_HV_ratio');
PALSARComposite = PALSARComposite.addBands(hh_hv_ratio);

print(PALSARComposite);
Map.addLayer(PALSARComposite, sarHhVis, 'SAR HH');

//Preparing GLO-30 slope and elevation
// ****************************************************

var glo30Filtered = glo30
  .filter(ee.Filter.bounds(roi))
  .select('DEM');

// Extract the projection
var demProj = glo30Filtered.first().select(0).projection();

// The dataset consists of individual images
// Create a mosaic and set the projection
var elevation = glo30Filtered.mosaic().rename('dem')
  .setDefaultProjection(demProj);

// Compute the slope
var slope = ee.Terrain.slope(elevation);

// Create an image with slope and elevation bands
var demBands = elevation.addBands(slope);

// Preparing GEDI L4A Mosaic
// ****************************************************

// Function to select highest quality GEDI data
var qualityMask = function(image) {
  return image.updateMask(image.select('l4_quality_flag').eq(1))
      .updateMask(image.select('degrade_flag').eq(0));
};

// Function to mask unreliable GEDI measurements
// with a relative standard error > 50% 
// agbd_se / agbd > 0.5
var errorMask = function(image) {
  var relative_se = image.select('agbd_se')
    .divide(image.select('agbd'));
  return image.updateMask(relative_se.lte(0.5));
};

// Function to mask GEDI measurements on slopes > 30%
var slopeMask = function(image) {
  return image.updateMask(slope.lt(30));
};

// Function to mask GEDI measurements on the daytime solar_elevation > 0
var solarMask = function(image){
  var solarband = image.select('solar_elevation');
  return image.updateMask(solarband.lt(0));
}

var agbdRangeFilter = function(image) {
  return image.updateMask(image.select('agbd').lte(800));
};

var gediFiltered = gedi
  .filter(ee.Filter.date("2020-01-01","2021-01-01"))
  .filter(ee.Filter.bounds(roi));

var gediProjection = ee.Image(gediFiltered.first())
  .select('agbd').projection();

var gediProcessed = gediFiltered
  .map(qualityMask)
  .map(errorMask)
  .map(slopeMask)
  .map(solarMask)
  .map(agbdRangeFilter);

var gediRaw = gediFiltered.mosaic()
  .select('agbd').setDefaultProjection(gediProjection);

var gediMosaic = gediProcessed.mosaic()
  .select('agbd').setDefaultProjection(gediProjection);

// Visualize the composites

var rgbVis = {
  min: 0.0, max: 0.3, gamma: 1.2,
  bands: ['B4', 'B3', 'B2'],
};
Map.addLayer(
  s2Composite.clip(roi), rgbVis, 'Sentinel-2 Composite');  

Map.addLayer(elevation.clip(roi),
  {min:0, max: 1000}, 'Elevation', false);
Map.addLayer(slope.clip(roi),
  {min: 0, max: 45}, 'Slope', false);

var gediVis = {
  min: 0,
  max: 200,
  palette: ['#edf8fb','#b2e2e2','#66c2a4','#2ca25f','#006d2c'],
  bands: ['agbd']
};

Map.addLayer(gediFiltered.mosaic().clip(roi),
  gediVis, 'GEDI L4A (Raw)', false);
  
Map.addLayer(gediMosaic.clip(roi), 
  gediVis, 'GEDI L4A (Filtered)');

// Clip and export the images as Assets
// ****************************************************

// Replace this with your asset folder
// The folder must exist before exporting
var exportPath = 'projects/ee-wangxy0209/assets/EstAGB/';

print(s2Composite);
print(demBands);
print(gediMosaic);

Export.image.toAsset({
  image: s2Composite.clip(roi),
  description: 'S2_Composite_Export',
  assetId: exportPath + 's2_composite',
  region: roi,
  scale: 30,
  crs: 'EPSG:3857',
  maxPixels: 1e13
});

Export.image.toAsset({
  image: PALSARComposite.clip(roi),
  description: 'PALSAR_Composite_Export',
  assetId: exportPath + 'palsar_composite',
  region: roi,
  scale: 30,
  crs: 'EPSG:3857',
  maxPixels: 1e13
});

Export.image.toAsset({
  image: demBands.clip(roi),
  description: 'DEM_Bands_Export',
  assetId: exportPath + 'dem_bands',
  region: roi,
  scale: 30,
  crs: 'EPSG:3857',
  maxPixels: 1e13
});

Export.image.toAsset({
  image: gediMosaic.clip(roi),
  description: 'GEDI_Mosaic_Export',
  assetId: exportPath + 'gedi_mosaic',
  region: roi,
  scale: 30,
  crs: 'EPSG:3857',
  maxPixels: 1e13
});

/*
Copyright (c) 2025 wangxy0209.
This work is licensed under the terms of the MIT license.  
For a copy, see https://opensource.org/licenses/MIT
*/