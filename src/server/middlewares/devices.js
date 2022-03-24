import deviceController from '../controllers/devices';

export const getDevice = async (req, res, next) => {
  const { dongleId } = req.params;
  req.device = await deviceController.getDeviceFromDongleId(dongleId);
  next();
};

export default null;
