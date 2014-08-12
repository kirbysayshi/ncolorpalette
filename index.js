var Clusterer = require('./lib/clusterer');
var converge = require('./lib/converge');
var palettes = require('./lib/palettes');

var cvsOutputRgb = document.getElementById('cvs-n-color-rgb');
var ctxOutputRgb = cvsOutputRgb.getContext('2d');

document.addEventListener('dragenter', function(e) {
  document.body.classList.add('drag-valid');
  e.preventDefault();
}, false);

document.addEventListener('dragover', function(e) {
  document.body.classList.add('drag-valid');
  e.preventDefault();
}, false);

document.addEventListener('dragleave', function(e) {
  document.body.classList.remove('drag-valid');
}, false);

document.addEventListener('drop', function(e) {
  console.log('drop', e);
  document.body.classList.remove('drag-valid');

  var files = e.dataTransfer.files;

  if (!files[0]) {
    throw new Error('No files or invalid file was dropped.');
  }

  var reader = new FileReader();
  reader.readAsDataURL(files[0]);
  reader.addEventListener('loadend', function() {
    var imgInput = document.createElement('img');
    imgInput.src = reader.result;
    imgInput.addEventListener('load', function load(e) {
      imgInput.removeEventListener('load', load);
      console.log('input display ready');

      cvsOutputRgb.width = imgInput.width;
      cvsOutputRgb.height = imgInput.height;

      ctxOutputRgb.drawImage(imgInput, 0, 0);

      var imgData = ctxOutputRgb.getImageData(0, 0, imgInput.width, imgInput.height);
      var clusterCount = 4; // TODO: this should come from palette
      var clusterData = Clusterer.init(imgData.data, clusterCount, 4);

      var async = false;
      var ASYNC_AREA_LIMIT = 120000;

      if (imgData.width * imgData.height > ASYNC_AREA_LIMIT) {
        async = true;
      }

      var convergeStart = window.performance.now();
      var palette = palettes.gameboy.slice(0);
      var outputImageData = ctxOutputRgb.createImageData(imgData);

      converge(clusterData, async,
        function progress(clusterData, convergeCount, pixelsMoved) {
          console.log('converge', convergeCount, async == true ? 'ASYNC' : 'SYNC', pixelsMoved);
          Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
          ctxOutputRgb.putImageData(outputImageData, 0, 0);
        },
        function(err, clusterData, convergeCount) {
          console.log('converged in', convergeCount, (window.performance.now() - convergeStart) + 'ms');
          Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
          ctxOutputRgb.putImageData(outputImageData, 0, 0);
        })
    })
  })

  e.preventDefault();
  e.stopPropagation();
}, false)