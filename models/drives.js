let db;

function getDrives(dongleId) {

}

async function getDevice(dongleId) {
  return db.get('SELECT * FROM devices WHERE dongle_id = ?', dongleId);
}

async function deviceCheckIn(dongleId) {
  return db.run(
    'UPDATE devices SET last_ping = ? WHERE dongle_id = ?',
    Date.now(),
    dongleId,
  );
}

module.exports = (_db) => {
  db = _db;

  return {
    getDevice,
    deviceCheckIn,
  };
};
