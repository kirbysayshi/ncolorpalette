
// Polyfill auto attached self to canvas proto if needed.
require('./vendor/canvas-toBlob');

var vash = require('vash');
var GIF = require('gif.js').GIF;

var Clusterer = require('./lib/clusterer');
var converge = require('./lib/converge');
var palettes = require('./lib/palettes');

var currentConvergence = null;
var currentGif = null;

var templates = (function() {
  var nodes = document.querySelectorAll('script[type="text/vash"]');
  nodes = [].slice.call(nodes);

  return nodes.reduce(function(tpls, node) {
    tpls[node.id] = vash.compile(node.innerHTML);
    return tpls;
  }, {})
}())

function current() {

  var q = document.querySelector.bind(document);

  // Palettes are rendered separately, might not be there.
  var elPalette = q('[name=options-palettes]:checked');

  return {

    // Defaults/Constants
    ASYNC_AREA_LIMIT: 120000,

    GIF_QUANTIZATION_QUALITY: 10,

    // DOM Options
    palette: elPalette ? palettes[elPalette.value] : null,
    async: q('#options-async').checked,
    asGif: q('#options-as-gif').checked,
    gifTwinkle: parseInt(q('#options-gif-twinkle-delay').value, 10),
    gifFrame: parseInt(q('#options-gif-frame-delay').value, 10),

    paletteWrapper: q('#palette-wrapper'),
    image: q('#img-input'),
    dstCvs: q('#cvs-n-color-rgb'),
    dstImg: q('#img-output'),
    dstCvsGif: q('#cvs-n-color-gif'),
    dstImgGif: q('#img-output-gif'),

    loadingPng: q('#png-loading'),
    loadingGif: q('#gif-loading')
  }
}

function now() {
  return window.performance
    ? window.performance.now()
    : Date.now();
}

current().paletteWrapper.innerHTML = Object.keys(palettes).map(function(id) {
  var palette = palettes[id];
  palette.id = id;
  return templates['tpl-palette'](palette);
}).join('\n');

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
  e.preventDefault();
  console.log('drop', e);
  document.body.classList.remove('drag-valid');

  var files = e.dataTransfer.files;

  if (!files[0]) {
    throw new Error('No files or invalid file was dropped.');
  }

  var reader = new FileReader();
  reader.readAsDataURL(files[0]);
  reader.addEventListener('loadend', function() {

    var c = current();
    c.image.src = reader.result;
    c.image.addEventListener('load', function load(e) {
      c.image.removeEventListener('load', load);
      console.log('input display ready');
      redraw(c);
    })
  })

  e.stopPropagation();
}, false)

document.querySelector('input[type="file"]').addEventListener('change', function(e) {
  var file = e.target.files[0];

  if (!file) {
    throw new Error('No file or invalid file was selected');
  }

  var exif = require('exif-component');
  var exifRotate = require('./vendor/exif-rotate');

  var reader = new FileReader();
  reader.readAsArrayBuffer(file);
  reader.addEventListener('loadend', function() {
    var c = current();

    var blob = new Blob([reader.result], {type: file.type});
    var blobUrl = URL.createObjectURL(blob)
    c.image.src = blobUrl;
    c.image.addEventListener('load', function load(e) {
      c.image.removeEventListener('load', load);
      console.log('input display ready');
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }

      try {
        var orientationsToIndex = ['top-left', 'top-right', 'bottom-right', 'bottom-left', 'left-top', 'right-top', 'right-bottom', 'left-bottom'];
        var tags = exif(reader.result);
        var dataurl = exifRotate(c.image, orientationsToIndex.indexOf(tags.orientation));
        c.image.src = dataurl;
        c.image.addEventListener('load', function load(e) {
          c.image.removeEventListener('load', load);
          redraw(c);
        })
      } catch(e) {
        // No exif data.
        redraw(c);
      }

    })
  })

}, false)

// Listen to options
document.addEventListener('change', function(e) {
  var c = current();

  if (!c.image.src) return;

  redraw(c);
})

function redraw(opts, opt_cb) {

  if (currentConvergence) {
    // cancel
    currentConvergence();
    currentConvergence = null;
  }

  var srcImg = opts.image;
  var dstCvs = opts.dstCvs;
  var palette = opts.palette;
  var dstCtx = dstCvs.getContext('2d');
  var dstImg = opts.dstImg;

  var srcArea = srcImg.width * srcImg.height;
  var async = srcArea > opts.ASYNC_AREA_LIMIT && opts.async === true
    ? true
    : false;

  // Show loading indicator.
  opts.loadingPng.style.display = 'inline';

  // Make canvas visible to allow for animation.
  dstCvs.style.display = 'block';
  dstImg.style.display = 'none';

  // apply image to canvas
  dstCvs.width = srcImg.width;
  dstCvs.height = srcImg.height;
  dstCtx.drawImage(srcImg, 0, 0);

  // Init clusterer.
  var srcData = dstCtx.getImageData(0, 0, srcImg.width, srcImg.height);
  var dataFactor = 4; // assume rgba for now.
  var clusterCount = palette.pixels.length / dataFactor; // Assume rgba for now.
  var clusterData = Clusterer.init(srcData.data, clusterCount, dataFactor);

  // Init output data.
  var outputImageData = dstCtx.createImageData(srcData);

  var convergeStart = now();
  currentConvergence = converge(clusterData, async, progress, complete);

  function progress(clusterData, convergeCount, pixelsMoved) {
    console.log('converge', convergeCount, async == true ? 'ASYNC' : 'SYNC', pixelsMoved);
    Clusterer.applyPaletteToImageData(clusterData, palette.pixels, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);
  }

  function complete(err, clusterData, convergeCount) {

    var time = now() - convergeStart;

    document.querySelector('#output-stats').textContent =
      '(' + convergeCount + ' iterations, ' + time.toFixed(2) + 'ms)';

    console.log('converged in', convergeCount, time + 'ms');
    Clusterer.applyPaletteToImageData(clusterData, palette.pixels, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);

    dstCvs.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      dstImg.addEventListener('load', function onload() {
        URL.revokeObjectURL(url);
        opts.loadingPng.style.display = 'none';
        dstImg.removeEventListener('load', onload);
      })
      dstImg.src = url;
    })

    if (opts.asGif) {
      doGIF();
    }

    // Hide canvas, show image to allow for dragging out of the browser.
    setTimeout(function() {
      dstCvs.style.display = 'none';
      dstImg.style.display = 'block';

      if (opt_cb) opt_cb.apply(null, arguments);
    })
  }

  function doGIF() {
    opts.loadingGif.style.display = 'inline';

    var dstCvsGif = opts.dstCvsGif;
    var dstCtxGif = dstCvsGif.getContext('2d');
    var dstImgGif = opts.dstImgGif;
    var outputGifImageData = dstCtx.createImageData(outputImageData);

    dstCvsGif.width = outputGifImageData.width;
    dstCvsGif.height = outputGifImageData.height;

    if (currentGif) {
      currentGif.abort();
    }

    currentGif = new GIF({
      workers: palette.pixels.length / 4,
      quality: opts.GIF_QUANTIZATION_QUALITY,
      workerScript: 'vendor/gif.worker.js'
    })

    currentGif.on('finished', function(blob) {
      console.log('gif finished called')
      var url = URL.createObjectURL(blob);
      dstImgGif.addEventListener('load', function onload() {
        URL.revokeObjectURL(url);
        opts.loadingGif.style.display = 'none';
        dstImgGif.removeEventListener('load', onload);
      })
      dstImgGif.src = url;
    })

    var cycledPalette = palette.pixels;

    for (var i = 0; i < palette.pixels.length / 4; i++) {
      cycledPalette = applyThenCyclePalette(clusterData, cycledPalette, outputGifImageData);
      dstCtxGif.putImageData(outputGifImageData, 0, 0);
      currentGif.addFrame(dstCvsGif, {
        copy: true,
        delay: i == 0
          ? opts.gifTwinkle
          : opts.gifFrame
      });
    }

    currentGif.render();
  }
}

function applyThenCyclePalette(clusterData, prevPalette, outputImageData) {
  var cycledPalette = prevPalette.slice(0);
  Clusterer.applyPaletteToImageData(clusterData, cycledPalette, outputImageData);
  var front = cycledPalette.splice(0, 4);
  cycledPalette.push.apply(cycledPalette, front);
  return cycledPalette;
}