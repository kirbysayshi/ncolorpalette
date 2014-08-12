var Clusterer = require('./lib/clusterer');
var converge = require('./lib/converge');
var palettes = require('./lib/palettes');

var imgInput = document.getElementById('img-input');
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
      converge(clusterData, async, function progress() {},
        function(err, clusterData, convergeCount) {
          console.log('converged in', convergeCount);
        })

      // Make a blank destination image data.
      var palette = palettes.gameboy.slice(0);
      var outputImageData = ctxOutputRgb.createImageData(imgData);
      Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
      ctxOutputRgb.putImageData(outputImageData, 0, 0);
    })
  })

  e.preventDefault();
  e.stopPropagation();
}, false)