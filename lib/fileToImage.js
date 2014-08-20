var exif = require('exif-component');
var exifRotate = require('../vendor/exif-rotate');

module.exports = function(file, img, cb) {

  // First load the file as an image.
  img.onload = onload;
  var url = URL.createObjectURL(file);
  img.src = url;

  function onload(e) {
    URL.revokeObjectURL(url);

    // If we have an orientation index, then rotate.
    orientationIndex(file, function(err, index) {
      if (err) return cb(null, img);

      rotate(img, index, function(err, img) {
        return cb(err, img);
      })
    })
  }
}

// cb(err, loadedImg)
function rotate(img, exifOrientationIndex, cb) {
  if (exifOrientationIndex === -1) {
    return cb(null, img);
  }

  var cvs = exifRotate(img, exifOrientationIndex);
  cvs.toBlob(function(blob) {
    var url = URL.createObjectURL(blob);

    img.onload = function() {
      URL.revokeObjectURL(url);
      cb(null, img);
    }

    img.src = url;
  })
}

// cb(err, exifOrientationIndex)
function orientationIndex(file, cb) {

  var orientationsToIndex = [
    'top-left',
    'top-right',
    'bottom-right',
    'bottom-left',
    'left-top',
    'right-top',
    'right-bottom',
    'left-bottom'
  ];

  var reader = new FileReader();
  reader.readAsArrayBuffer(file);
  reader.addEventListener('loadend', function() {
    try {
      var tags = exif(reader.result);
      var index = orientationsToIndex.indexOf(tags.orientation);
      return cb(null, index > -1 ? index + 1 : index);
    } catch(e) {
      return cb(e);
    }
  })
}