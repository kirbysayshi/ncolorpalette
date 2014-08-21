var juggler = require('./imagejuggler');
var exif = require('exif-component');
var exifRotate = require('../vendor/exif-rotate');

var orientations = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
  'left-top',
  'right-top',
  'right-bottom',
  'left-bottom'
];

function extract(buf) {
  try {
    var tags = exif(buf);
  } catch(e) {
    return null;
  }

  return tags;
}

module.exports = function(file, opt_img, cb) {
  if (!cb) { cb = opt_img; opt_img = null; }
  juggler.fileToArrayBuffer(file, function(err, ab) {
    juggler.fileToImage(file, opt_img, function(err, img) {

      var tags = extract(ab);

      // No exif data.
      if (!tags) { return cb(null, img); }

      var index = orientations.indexOf(tags.orientation);

      // exif orientation not found, assume top-left (no change)
      // for some reason they're off by one.
      if (index == -1) { index += 2; }
      else { index += 1; }

      var cvs = exifRotate(img, index);
      juggler.canvasToImage(cvs, img, function(err, img) {
        cb(err, img);
      })
    })
  })
}