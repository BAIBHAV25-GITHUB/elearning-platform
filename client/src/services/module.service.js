import api from '../api/axios';

export const getCourseModulesApi = async (courseId) => {
  const response = await api.get(`/courses/${courseId}/modules`);
  return response.data;
};

export const createModuleApi = async (courseId, moduleData) => {
  const response = await api.post(`/courses/${courseId}/modules`, moduleData);
  return response.data;
};

