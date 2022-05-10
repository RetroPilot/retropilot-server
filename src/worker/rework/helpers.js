export function calculateDistance(lat1, lon1, lat2, lon2, reasonableSpeed) {
  const p = 0.017453292519943295; // Math.PI / 180
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2
      + c(lat1 * p) * c(lat2 * p) * ((1 - c((lon2 - lon1) * p)) / 2);

  let distMetres = 1000 * 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
  if (distMetres > 70 && reasonableSpeed) {
    // each segment is max. 60s. if the calculated speed would exceed ~250km/h for this segment, we assume the coordinates off / defective and skip it
    distMetres = 0;
  }
  return distMetres;
}
export default null;
