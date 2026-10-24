'use strict';
let done = false;
function finish() {
  if (done) return;
  done = true;
  document.body.classList.add('depart');
  setTimeout(() => window.whaleIntro.finish(), 450);
}
document.querySelector('.skip').addEventListener('click', finish);
document.querySelector('video').addEventListener('error', () => setTimeout(finish, 800));
setTimeout(finish, 5800);
