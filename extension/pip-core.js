// Shared picture-in-picture toggle. Self-contained so it can also be injected
// with chrome.scripting.executeScript({ func: asmrPipToggle }).
// Must call requestPictureInPicture() synchronously (no await before it) to keep the click's user gesture.
function asmrPipToggle(preferred) {
  try {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
      return "exited";
    }
    const videos = [...document.querySelectorAll("video")].filter(v => {
      const r = v.getBoundingClientRect();
      return r.width >= 120 && r.height >= 68 && v.readyState > 0;
    });
    if (!videos.length) return "no-video";
    const score = v => {
      const r = v.getBoundingClientRect();
      return r.width * r.height * (v.paused ? 1 : 4);   // prefer the biggest playing one
    };
    const video = preferred && videos.includes(preferred) ? preferred : videos.sort((a, b) => score(b) - score(a))[0];
    video.disablePictureInPicture = false;
    video.removeAttribute("disablepictureinpicture");
    const p = video.requestPictureInPicture();
    if (p && p.catch) p.catch(() => {});
    return "entered";
  } catch (e) {
    return "error: " + e.message;
  }
}
