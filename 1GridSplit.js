// Define a function to partition the study area (ROI) into n × m tiles
function gridSplit(roi, n, m) {
  var bounds = roi.geometry().bounds().getInfo().coordinates[0];
  var xmin = bounds[0][0] - 0.1;
  var xmax = bounds[1][0] + 0.1;
  var ymin = bounds[0][1] - 0.1;
  var ymax = bounds[2][1] + 0.1;

  var dx = (xmax - xmin) / n;
  var dy = (ymax - ymin) / m;

  var xx = ee.List.sequence(xmin, xmax, dx);
  var yy = ee.List.sequence(ymin, ymax, dy);

  var rects = xx.map(function(i) {
    return yy.map(function(j) {
      var x1 = ee.Number(i);
      var x2 = ee.Number(i).add(ee.Number(dx));
      var y1 = ee.Number(j);
      var y2 = ee.Number(j).add(ee.Number(dy));
      var coords = ee.List([x1, y1, x2, y2]);
      var rect = ee.Algorithms.GeometryConstructors.Rectangle(coords);
      return ee.Feature(rect);
    });
  }).flatten();

  var rects_col = ee.FeatureCollection(rects).filterBounds(roi.geometry());
  var GridNum = rects_col.size().getInfo();
  print('GridNum: ', GridNum);

  var idList = ee.List.sequence(0, GridNum - 1);
  var grid = ee.FeatureCollection(idList.map(function(i) {
    return ee.Feature(rects_col.toList(rects_col.size()).get(i)).set("grid_id", ee.Number(i).add(1));
  }));
  return grid;
}

var subroi = gridSplit(roi, 35, 35); //Here we divide china into 35×35 tiles
print(subroi);
Map.addLayer(subroi, {}, 'subroi_all');

Export.table.toAsset({
  collection: subroi,
  description: 'subroi_Export',
  assetId: 'projects/lofty-justice-457909-t0/assets/EstAGB/subroi508' // Export path
});
