async function useCurrentLocation(btnId, latId, lngId){
  const btn = document.getElementById(btnId);
  if(!btn) return;
  btn.addEventListener("click", () => {
    if(!navigator.geolocation){
      alert("Location not supported on this device.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Getting location...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById(latId).value = pos.coords.latitude;
        document.getElementById(lngId).value = pos.coords.longitude;
        btn.textContent = "Location captured ✓";
        setTimeout(()=>{btn.textContent="📍 Use Current Location"; btn.disabled=false;}, 900);
      },
      (err) => {
        alert("Location permission denied or unavailable.");
        btn.textContent = "📍 Use Current Location";
        btn.disabled = false;
      },
      { enableHighAccuracy:true, timeout:10000 }
    );
  });
}
