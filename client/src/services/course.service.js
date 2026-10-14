import api from '../api/axios';

export const createCourseApi = async (courseData) => {
  const response = await api.post('/courses', courseData);
  return response.data;
};

export const getInstructorCoursesApi = async () => {
  const response = await api.get('/courses/instructor/me');
  return response.data;
};


export const publishCourseApi = async (courseId) => {
  const response = await api.patch(`/courses/${courseId}/publish`);
  return response.data;
};
