import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import VideoPlayer from "../../components/video/VideoPlayer";
import LessonPlayer from "../../components/video/LessonPlayer";
import ModuleComments from "../../components/discussion/ModuleComments";

export default function CoursePlayer() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const [course, setCourse] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [activeContent, setActiveContent] = useState(null);
  const [completedContentIds, setCompletedContentIds] = useState(new Set());
  const [positions, setPositions] = useState({});
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlayerData = async () => {
      try {
        const [courseRes, enrollmentsRes] = await Promise.all([
          api.get(`/courses/${courseId}`),
          api.get("/enrollments/me"),
        ]);

        const courseData = courseRes.data.course || courseRes.data;
        setCourse(courseData);

        const currentEnrollment = enrollmentsRes.data.enrollments?.find(
          (e) => String(e.course_id) === String(courseId),
        );
        setEnrollment(currentEnrollment);

        if (currentEnrollment) {
          const progressRes = await api.get(
            `/progress/${currentEnrollment.enrollment_id}`,
          );
          const completedSet = new Set(
            progressRes.data.progress
              ?.filter((p) => p.completed)
              .map((p) => p.content_id),
          );
          setCompletedContentIds(completedSet);
          setPositions(
            Object.fromEntries((progressRes.data.progress || []).map((p) => [p.content_id, p.watch_duration || 0])),
          );
        }

        // Set default initial video content
        if (
          courseData.modules?.length > 0 &&
          courseData.modules[0].contents?.length > 0
        ) {
          setActiveContent(courseData.modules[0].contents[0]);
        }
      } catch (err) {
        console.error("Failed to load course player:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerData();
  }, [courseId]);

  const handleProgressUpdate = (contentId, isCompleted, seconds) => {
    if (seconds !== undefined) setPositions((prev) => ({ ...prev, [contentId]: seconds }));
    if (isCompleted) {
      setCompletedContentIds((prev) => new Set([...prev, contentId]));
    }
  };

  // Every lesson in course order, so the player can move on to the next one when a video ends.
  const allContents = course
    ? (course.modules || []).flatMap(
        (m) => m.contents || [],
      )
    : [];

  const handleVideoEnded = () => {
    if (!activeContent) return;
    const activeId = activeContent.content_id || activeContent.id;
    const idx = allContents.findIndex(
      (c) => (c.content_id || c.id) === activeId,
    );
    const next = allContents[idx + 1];
    if (idx !== -1 && next) {
      setAutoPlayNext(true);
      setActiveContent(next);
    }
  };

  const activeModule = activeContent
    ? (course?.modules || []).find((m) =>
        (m.contents || []).some((c) => (c.content_id || c.id) === (activeContent.content_id || activeContent.id)),
      )
    : null;

  if (loading)
    return (
      <div className="text-center py-20 text-slate-600">
        Loading learning environment...
      </div>
    );
  if (!course)
    return (
      <div className="text-center py-20 text-slate-600">Course not found.</div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="h-16 bg-slate-800 border-b border-slate-700 px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/courses/${courseId}`)}
            className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition"
          >
            ← Back
          </button>
          <h1 className="text-lg font-semibold truncate">{course.title}</h1>
        </div>
        <button
          onClick={() => navigate("/student/certificates")}
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
              {activeContent.parts?.length > 0 ? (
                // A long video stored as pieces: plays as ONE video (one seek bar, one clock)
                <LessonPlayer
                  key={`video-${activeContent.content_id}`}
                  parts={activeContent.parts}
                  enrollmentId={enrollment?.enrollment_id}
                  contentId={activeContent.content_id}
                  onProgressUpdate={handleProgressUpdate}
                  onEnded={handleVideoEnded}
                  autoPlay={autoPlayNext}
                  startAt={completedContentIds.has(activeContent.content_id) ? 0 : positions[activeContent.content_id] || 0}
                />
              ) : (
                <VideoPlayer
                  videoUrl={activeContent.video_url || activeContent.url}
                  enrollmentId={enrollment?.enrollment_id}
                  contentId={activeContent.content_id || activeContent.id}
                  onProgressUpdate={handleProgressUpdate}
                  onEnded={handleVideoEnded}
                  autoPlay={autoPlayNext}
                  startAt={positions[activeContent.content_id || activeContent.id] || 0}
                />
              )}
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {activeContent.title}
                </h2>
                <p className="text-slate-400 mt-2">
                  {activeContent.description || "No description provided."}
                </p>
              </div>
              {activeModule && <ModuleComments key={activeModule.module_id} moduleId={activeModule.module_id} />}
            </div>
          ) : (
            <div className="text-center py-20 text-slate-400">
              Select a lesson from the menu to start learning.
            </div>
          )}
        </div>

        {/* Course Modules Sidebar */}
        <aside className="w-full lg:w-96 bg-slate-800 border-l border-slate-700 overflow-y-auto p-4">
          <h3 className="text-base font-bold text-slate-200 uppercase tracking-wider mb-4">
            Course Content
          </h3>
          <div className="space-y-4">
            {(
              course.modules || []
            ).map((module, mIdx) => {
              // A module that is just one video with the module's own name (e.g. "Lesson 1")
              // is shown as a single row instead of a header plus an identical item.
              const only = module.contents?.length === 1 && module.contents[0].title === module.title ? module.contents[0] : null;
              if (only) {
                const isSelected = activeContent && (activeContent.content_id || activeContent.id) === only.content_id;
                return (
                  <button
                    key={module.module_id || mIdx}
                    onClick={() => {
                      setAutoPlayNext(false);
                      setActiveContent(only);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium flex items-center justify-between transition ${
                      isSelected ? "bg-indigo-600 text-white" : "bg-slate-900/50 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    <span className="truncate pr-2">
                      {mIdx + 1}. {module.title}
                    </span>
                    {completedContentIds.has(only.content_id) ? (
                      <span className="text-emerald-400 font-bold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800 text-xs">
                        ✓ Done
                      </span>
                    ) : positions[only.content_id] > 0 && only.duration_sec > 0 ? (
                      <span className="text-xs text-slate-300">
                        {Math.min(99, Math.round((positions[only.content_id] / only.duration_sec) * 100))}%
                      </span>
                    ) : null}
                  </button>
                );
              }
              return (
              <div
                key={module.module_id || mIdx}
                className="bg-slate-900/50 rounded-lg p-3"
              >
                <div className="text-sm font-semibold text-indigo-400 mb-2">
                  Module {mIdx + 1}: {module.title}
                </div>
                <div className="space-y-1">
                  {module.contents?.map((content, cIdx) => {
                    const cId = content.content_id || content.id;
                    const isSelected =
                      activeContent &&
                      (activeContent.content_id || activeContent.id) === cId;
                    const isCompleted = completedContentIds.has(cId);

                    return (
                      <button
                        key={cId || cIdx}
                        onClick={() => {
                          setAutoPlayNext(false);
                          setActiveContent(content);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center justify-between transition ${
                          isSelected
                            ? "bg-indigo-600 text-white"
                            : "hover:bg-slate-700 text-slate-300"
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
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
