// ****************************************************
// Part-2: Building a Regression Model
// ****************************************************

// Import the Assets
// ****************************************************

// Replace this with your asset folder used in Part-1

var subroi = ee.FeatureCollection("projects/lofty-justice-457909-t0/assets/EstAGB/subroi508"),
    roi = ee.FeatureCollection("users/wxy/china"),
    demBands = ee.Image("projects/lofty-justice-457909-t0/assets/EstAGB/dem_bands"),
    palsar = ee.Image("projects/lofty-justice-457909-t0/assets/EstAGB/palsar_composite"),
    s2Composite = ee.Image("users/wxy/s2_composite"),
    gediMosaic = ee.Image("projects/lofty-justice-457909-t0/assets/EstAGB/GEDI_Merge");

// Set predictor variables
var predictors = s2Composite.bandNames().cat(demBands.bandNames())
                .cat(palsar.bandNames());

var predict = gediMosaic.bandNames().get(0);
print('predictors', predictors);
print('predict', predict);

var gridScale = 30;

var Vis = {
  min: 0,
  max: 200,
  palette: ['#edf8fb','#b2e2e2','#66c2a4','#2ca25f','#006d2c'],
  bands: ['agbd']
};

// Create a stacked image
// We assemble a composite with all the bands
var stacked = s2Composite.addBands(demBands).addBands(gediMosaic)
              .addBands(palsar);

// As larger GEDI pixels contain masked original
// pixels, it has a transparency mask.
// We update the mask to remove the transparency
var stackedResampled = stacked.updateMask(stacked.mask().gt(0));

Map.addLayer(subroi, {}, 'subroi_all');

// Hyperparameter tuning function
/*function tuneHyperparameters(training, predictors, predict) {
  var numTreesList = ee.List.sequence(10, 150, 10);
  var bagFractionList = ee.List.sequence(0.1, 0.9, 0.1);

  var results = numTreesList.map(function(numTrees) {
    return bagFractionList.map(function(bagFraction) {
      var model = ee.Classifier.smileRandomForest({
        numberOfTrees: numTrees,
        bagFraction: bagFraction
      }).setOutputMode('REGRESSION').train({
        features: training,
        classProperty: predict,
        inputProperties: predictors
      });

      var predictions = training.classify(model, 'agbd_predicted');
      var rmse = ee.Array(predictions.aggregate_array('agbd'))
          .subtract(ee.Array(predictions.aggregate_array('agbd_predicted')))
          .pow(2)
          .reduce('mean', [0])
          .sqrt()
          .get([0]);

      return ee.Feature(null, {
        'numTrees': numTrees,
        'bagFraction': bagFraction,
        'rmse': rmse
      });
    });
  }).flatten();

  var resultsFc = ee.FeatureCollection(results);
  //   // 可视化 RMSE 与 numberOfTrees 的关系
  // var chart = ui.Chart.feature.byFeature({
  //   features: resultsFc,
  //   xProperty: 'numTrees',
  //   yProperties: ['rmse']
  // }).setChartType('ScatterChart')
  //   .setOptions({
  //     title: 'RMSE vs Number of Trees',
  //     hAxis: {title: 'Number of Trees'},
  //     vAxis: {title: 'RMSE'},
  //     pointSize: 5
  //   });
  // print(chart);
  var bestParams = resultsFc.sort('rmse', true).first();
  return bestParams;
}*/

// Process each tile and optimize the model
var processAndExport = function(index) {
  var feature = ee.Feature(subroi.toList(subroi.size()).get(index));
  var featureGeometry = feature.geometry();

    // Get the location of the current tile
  var rectBounds = featureGeometry.bounds().getInfo().coordinates[0];
    
  // To improve fault tolerance and ensure the inclusion of edge pixels, 
  // the spatial extent was expanded by 0.1 units in all directions
  var xmin = rectBounds[0][0];
  var xmax = rectBounds[1][0];
  var ymin = rectBounds[0][1];
  var ymax = rectBounds[2][1];
        
  // Obtain the neighborhood of the current tile 
  // (3×3 including horizontal, vertical, and diagonal neighbors)
  var dx = xmax-xmin;
  var dy = ymax-ymin;
        
  // Construct neighborhood window
  var newXmin = xmin-dx;
  var newYmin = ymin-dy;
  var newXmax = xmax+dx;
  var newYmax = ymax+dy;
  var coords = ee.List([newXmin, newYmin, newXmax, newYmax]);
  var rect = ee.Algorithms.GeometryConstructors.Rectangle(coords);
    
  // Merge the neighborhood regions
  var neighborGeometry = ee.Feature(rect).geometry();
  var Dataset = stackedResampled.clip(neighborGeometry);

// Our GEDI image is mostly masked and contain values
// at only a small subset of pixels
// If we used sample() it will return mostly empty values
// To overcome this, we create a class-band from the GEDI
// mask and use stratifiedSampling() to ensure we sample from
// the non-masked areas.

  var classBand = Dataset.select([predict]).mask().toInt().rename('class');

// We set classPoints to [0, numSamples]
// This will give us 0 points for class 0 (masked areas)
// and numSample points for class 1 (non-masked areas)
  var training = Dataset.addBands(classBand).stratifiedSample({
    numPoints: 2000,
    classBand: 'class',
    scale: gridScale,
    region: neighborGeometry,
    classValues: [0, 1],
    classPoints: [0, 2000],
    dropNulls: true,
    geometries: true,  // Key parameters
    tileScale: 16
  });

  print('Number of Features Extracted', training.size());
  // Visualize stratifiedSamples
  Map.addLayer(training, {color: 'red'}, 'Sample Points');
  
  // Set the number of folds K to 5
  var K = 5;

  // Randomly shuffle the dataset
  var randomSeed = 42;
  var trainingWithRandom = training.randomColumn('random', randomSeed);

  // Assign a fold number to each sample
  var fold = trainingWithRandom
  .map(function(feature) {
      var foldNumber = ee.Number(feature.get('random')).multiply(K).floor();
      return feature.set('fold', foldNumber);
   });

  // Define a K-fold cross-validation function
  var crossValidation = function(k) {
  var trainingSet = fold.filter(ee.Filter.neq('fold', k));
  var validationSet = fold.filter(ee.Filter.eq('fold', k));

  var models = ee.Classifier.smileRandomForest({
      numberOfTrees: 50,
      bagFraction: 0.63
  }).setOutputMode('REGRESSION').train({
      features: trainingSet,
      classProperty: 'agbd',
      inputProperties: predictors
  });
    
  // Make predictions on the validation set
  var validationPredictions = validationSet.classify(models);

  var observed = ee.Array(validationPredictions.aggregate_array('agbd'));
  var predicted = ee.Array(validationPredictions.aggregate_array('classification'));
     
  // Calculate RMSE
  var rmse = observed.subtract(predicted).pow(2)
        .reduce('mean', [0]).sqrt().get([0]);    
  return rmse
  };

  // Use the map function to perform cross-validation on all K folds.
  var rmseResults = ee.List.sequence(0, K-1).map(crossValidation);

  // Calculate standard deviation
  var rmseStdDev = rmseResults.reduce(ee.Reducer.stdDev());
  print(rmseStdDev);

  var model = ee.Classifier.smileRandomForest({
    numberOfTrees: 50,
    bagFraction: 0.63
  }).setOutputMode('REGRESSION').train({
    features: training,
    classProperty: predict,
    inputProperties: predictors
  });

  // Get model's predictions for training samples
  var predicted = training.classify({
    classifier: model,
    outputName: 'agbd_predicted'
  });
  
  // Calculate RMSE
  var calculateRmse = function(input) {
      var observed = ee.Array(
        input.aggregate_array('agbd'));
      var predicted = ee.Array(
        input.aggregate_array('agbd_predicted'));
      var rmse = observed.subtract(predicted).pow(2)
        .reduce('mean', [0]).sqrt().get([0]);
      return rmse;
  };
  var rmse = calculateRmse(predicted);
  print('RMSE', rmse)
  
  // Create a plot of observed vs. predicted values
  var chart = ui.Chart.feature.byFeature({
    features: predicted.select(['agbd', 'agbd_predicted']),
    xProperty: 'agbd',
    yProperties: ['agbd_predicted'],
  }).setChartType('ScatterChart')
    .setOptions({
      title: 'Aboveground Biomass Density (Mg/Ha)',
      dataOpacity: 0.8,
      hAxis: {'title': 'Observed'},
      vAxis: {'title': 'Predicted'},
      legend: {position: 'right'},
      series: {
        0: {
          visibleInLegend: false,
          color: '#525252',
          pointSize: 3,
          pointShape: 'triangle',
        },
      },
      trendlines: {
        0: {
          type: 'linear', 
          color: 'black', 
          lineWidth: 1,
          pointSize: 0,
          labelInLegend: 'Linear Fit',
          visibleInLegend: true,
          showR2: true
        }
      },
      chartArea: {left: 100, bottom:100, width:'50%'},
  
  });
  print(chart);
  
  // Visualize feature importance
  /*var importance = ee.Dictionary(model.explain().get('importance'));

  var sum = importance.values().reduce(ee.Reducer.sum());
  var relativeImportance = importance.map(function(key, val) {
    return ee.Number(val).multiply(100).divide(sum);
  });
  // print('Feature Importance (Relative)', relativeImportance);

  var importanceFc = ee.FeatureCollection([
    ee.Feature(null, relativeImportance)
  ]);

  var chart1 = ui.Chart.feature.byProperty({
    features: importanceFc
  }).setOptions({
    title: 'Feature Importance',
    vAxis: {title: 'Importance (%)'},
    hAxis: {title: 'Feature'},
  });
  print(chart1);*/

  var predictedAgbd = Dataset.classify(model, 'agbd');
  Map.addLayer(predictedAgbd.clip(feature), Vis, 'Tile Prediction ' + index);

  Export.image.toDrive({
    image: predictedAgbd.clip(feature),
    description: 'Tile_' + index + '_AGBD',
    region: featureGeometry,
    scale: gridScale,
    maxPixels: 1e10,
    folder: 'GEE_exports'
  });
};

// Iteratively process all tiles
for (var i = 100; i < 110; i++) { 
  // Adjust the range of tile indices as needed
  processAndExport(i);
}