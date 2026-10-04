import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import VideoPlayer from '../../components/video/VideoPlayer';

export default function CoursePlayer() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const [course, setCourse] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [activeContent, setActiveContent] = useState(null);
  const [completedContentIds, setCompletedContentIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlayerData = async () => {
      try {
        const [courseRes, enrollmentsRes] = await Promise.all([
          api.get(`/courses/${courseId}`),
          api.get('/enrollments/my-enrollments')
        ]);

        const courseData = courseRes.data.course || courseRes.data;
        setCourse(courseData);

        const currentEnrollment = enrollmentsRes.data.enrollments?.find(
          (e) => String(e.course_id) === String(courseId)
        );
        setEnrollment(currentEnrollment);

        if (currentEnrollment) {
          const progressRes = await api.get(`/progress/${currentEnrollment.enrollment_id}`);
          const completedSet = new Set(
            progressRes.data.progress
              ?.filter((p) => p.completed)
              .map((p) => p.content_id)
          );
          setCompletedContentIds(completedSet);
        }

        // Set default initial video content
        if (courseData.modules?.length > 0 && courseData.modules[0].contents?.length > 0) {
          setActiveContent(courseData.modules[0].contents[0]);
        } else if (courseData.lessons?.length > 0) {
          setActiveContent(courseData.lessons[0]);
        }
      } catch (err) {
        console.error('Failed to load course player:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerData();
  }, [courseId]);

  const handleProgressUpdate = (contentId, isCompleted) => {
    if (isCompleted) {
      setCompletedContentIds((prev) => new Set([...prev, contentId]));
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-600">Loading learning environment...</div>;
  if (!course) return <div className="text-center py-20 text-slate-600">Course not found.</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="h-16 bg-slate-800 border-b border-slate-700 px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/student/dashboard')}
            className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition"
          >
            ← Back
          </button>
          <h1 className="text-lg font-semibold truncate">{course.title}</h1>
        </div>
        <button
          onClick={() => navigate('/student/certificates')}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg font-medium transition"
        >
          My Certificates
        </button>
      </header>

      {/* Main Content & Sidebar */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Main Video Viewport */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeContent ? (
            <div className="max-w-5xl mx-auto space-y-6">
              <VideoPlayer
                videoUrl={activeContent.video_url || activeContent.url}
                enrollmentId={enrollment?.enrollment_id}
                contentId={activeContent.content_id || activeContent.id}
                onProgressUpdate={handleProgressUpdate}
              />
              <div>
                <h2 className="text-2xl font-bold text-white">{activeContent.title}</h2>
                <p className="text-slate-400 mt-2">{activeContent.description || 'No description provided.'}</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-400">Select a lesson from the menu to start learning.</div>
          )}
        </div>

        {/* Course Modules Sidebar */}
        <aside className="w-full lg:w-96 bg-slate-800 border-l border-slate-700 overflow-y-auto p-4">
          <h3 className="text-base font-bold text-slate-200 uppercase tracking-wider mb-4">Course Content</h3>
          <div className="space-y-4">
            {(course.modules || [{ title: 'Lessons', contents: course.lessons }]).map((module, mIdx) => (
              <div key={module.module_id || mIdx} className="bg-slate-900/50 rounded-lg p-3">
                <div className="text-sm font-semibold text-indigo-400 mb-2">
                  Module {mIdx + 1}: {module.title}
                </div>
                <div className="space-y-1">
                  {module.contents?.map((content, cIdx) => {
                    const cId = content.content_id || content.id;
                    const isSelected = activeContent && (activeContent.content_id || activeContent.id) === cId;
                    const isCompleted = completedContentIds.has(cId);

                    return (
                      <button
                        key={cId || cIdx}
                        onClick={() => setActiveContent(content)}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center justify-between transition ${
                          isSelected ? 'bg-indigo-600 text-white' : 'hover:bg-slate-700 text-slate-300'
                        }`}
                      >
                        <span className="truncate pr-2">
                          {cIdx + 1}. {content.title}
                        </span>
                        {isCompleted && (
                          <span className="text-emerald-400 font-bold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800">
                            ✓ Done
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}