import api from '../api/axios';

export const getCourseModulesApi = async (courseId) => {
  const response = await api.get(`/courses/${courseId}/modules`);
  return response.data;
};

export const createModuleApi = async (courseId, moduleData) => {
  const response = await api.post(`/courses/${courseId}/modules`, moduleData);
  return response.data;
};

export const deleteContentApi = async (courseId, moduleId, contentId) => {
  const response = await api.delete(`/courses/${courseId}/modules/${moduleId}/content/${contentId}`);
  return response.data;
};

export const updateModuleApi = async (courseId, moduleId, patch) => {
  const response = await api.patch(`/courses/${courseId}/modules/${moduleId}`, patch);
  return response.data;
};

/** moduleIds = every module id of the course in the new order */
export const reorderModulesApi = async (courseId, moduleIds) => {
  const response = await api.put(`/courses/${courseId}/modules/order`, { moduleIds });
  return response.data;
};

export const deleteModuleApi = async (courseId, moduleId) => {
  const response = await api.delete(`/courses/${courseId}/modules/${moduleId}`);
  return response.data;
};
