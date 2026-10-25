import { deleteFromCloudinary } from '../integrations/cloudinary.js';
import { logger } from '../utils/logger.js';

/**
 * Removes Cloudinary files after their database rows are gone.
 * assets = [{ publicId, resourceType }]. Never throws; returns the public ids that failed
 * (they are logged so an admin can clean them up by hand).
 */
export const removeCloudinaryAssets = async (assets = []) => {
  const outcomes = await Promise.allSettled(
    assets.map((a) => deleteFromCloudinary(a.publicId, a.resourceType))
  );
  const failed = [];
  outcomes.forEach((o, i) => {
    if (o.status === 'rejected' || !['ok', 'not found'].includes(o.value?.result)) {
      failed.push(assets[i].publicId);
      logger.error('Cloudinary cleanup failed for', assets[i].publicId, o.reason?.message || o.value?.result);
    }
  });
  return failed;
};
