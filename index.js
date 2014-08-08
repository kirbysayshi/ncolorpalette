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
    imgInput.addEventListener('load', function(e) {
      console.log('input display ready');

      cvsOutputRgb.width = imgInput.width;
      cvsOutputRgb.height = imgInput.height;

      ctxOutputRgb.drawImage(imgInput, 0, 0);
    })
  })

  e.preventDefault();
  e.stopPropagation();
}, false)