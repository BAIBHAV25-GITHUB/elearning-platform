import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import VideoPlayer from "../../components/video/VideoPlayer";
import LessonPlayer from "../../components/video/LessonPlayer";
import ReadingLesson from "../../components/lesson/ReadingLesson";
import ModuleComments from "../../components/discussion/ModuleComments";

// enrollment statuses that give access to the course content
const ENTITLED = ["active", "completed"];

// small label for lessons that are not videos, so students know what they are opening
const TYPE_LABEL = { pdf: "PDF", text: "Text" };
const TypeBadge = ({ type }) =>
  TYPE_LABEL[type] ? (
    <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
      {TYPE_LABEL[type]}
    </span>
  ) : null;

export default function CoursePlayer() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [course, setCourse] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [activeContent, setActiveContent] = useState(null);
  const [completedContentIds, setCompletedContentIds] = useState(new Set());
  const [positions, setPositions] = useState({});
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const fetchPlayerData = async () => {
      try {
        const [courseRes, enrollmentsRes] = await Promise.all([
          api.get(`/courses/${courseId}`),
          api.get("/enrollments/me"),
        ]);

        const courseData = courseRes.data.course || courseRes.data;

        // A student can hold old dropped enrollments next to a current one: use the one that
        // gives access, else a pending one (to explain what is missing), else any.
        const mine = (enrollmentsRes.data.enrollments || []).filter(
          (e) => String(e.course_id) === String(courseId),
        );
        const currentEnrollment =
          mine.find((e) => ENTITLED.includes(e.enrollment_status)) ||
          mine.find((e) => e.enrollment_status === "pending") ||
          mine[0];

        // Access guard: the course's instructor, admins and students with an active / completed
        // enrollment may open the player. Everyone else goes back to the course page (the server
        // hides the media for them anyway, so the player would only show a broken screen).
        const canManage = user?.role === "admin" || courseData.instructor_id === user?.id;
        const isEntitledStudent = currentEnrollment && ENTITLED.includes(currentEnrollment.enrollment_status);
        if (!canManage && !isEntitledStudent) {
          const notice =
            currentEnrollment?.enrollment_status === "pending"
              ? "Your enrollment is waiting for payment. Finish it to start learning."
              : "Enroll in this course to start learning.";
          setRedirecting(true);
          navigate(`/courses/${courseId}`, { replace: true, state: { notice } });
          return;
        }

        setCourse(courseData);
        setEnrollment(isEntitledStudent ? currentEnrollment : null);
        let progressRows = [];

        if (isEntitledStudent) {
          const progressRes = await api.get(
            `/progress/${currentEnrollment.enrollment_id}`,
          );
          const completedSet = new Set(
            progressRes.data.progress
              ?.filter((p) => p.completed)
              .map((p) => p.content_id),
          );
          progressRows = progressRes.data.progress || [];
          setCompletedContentIds(completedSet);
          setPositions(
            Object.fromEntries((progressRes.data.progress || []).map((p) => [p.content_id, p.watch_duration || 0])),
          );
        }

        // Where to start: resume the lesson the student touched last and has not finished; otherwise the
        // first unfinished lesson; otherwise (everything done / new course) the first lesson.
        const lessons = (courseData.modules || []).flatMap((m) => m.contents || []);
        let start = lessons[0] || null;
        if (isEntitledStudent) {
          const rows = (progressRows || []).filter((p) => !p.completed);
          const recent = [...rows].sort((a, b) => new Date(b.last_accessed_at) - new Date(a.last_accessed_at))[0];
          const doneIds = new Set((progressRows || []).filter((p) => p.completed).map((p) => p.content_id));
          start =
            (recent && lessons.find((l) => l.content_id === recent.content_id)) ||
            lessons.find((l) => !doneIds.has(l.content_id)) ||
            start;
        }
        if (start) setActiveContent(start);
      } catch (err) {
        console.error("Failed to load course player:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerData();
    // user comes from AuthProvider, which only renders its children once the session is restored
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, user?.id, user?.role]);

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

  const readyTotal = allContents.length;
  const doneCount = allContents.filter((c) => completedContentIds.has(c.content_id || c.id)).length;
  const donePct = readyTotal ? Math.round((doneCount / readyTotal) * 100) : 0;
  const nextLesson = (() => {
    if (!activeContent) return null;
    const i = allContents.findIndex((c) => (c.content_id || c.id) === (activeContent.content_id || activeContent.id));
    return i !== -1 ? allContents[i + 1] || null : null;
  })();

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

  if (loading || redirecting)
    return (
      <div className="text-center py-20 text-slate-600">
        Loading learning environment...
      </div>
    );
  if (!course)
    return (
      <div className="text-center py-20 text-slate-600">Course not found.</div>
    );

  // What to show for the selected lesson, by type.
  const renderLesson = () => {
    const c = activeContent;
    const cId = c.content_id || c.id;

    // PDF and text lessons: viewer + "Mark as complete"
    if (c.type === "pdf" || c.type === "text") {
      return (
        <ReadingLesson
          key={`reading-${cId}`}
          content={c}
          enrollmentId={enrollment?.enrollment_id}
          completed={completedContentIds.has(cId)}
          onProgressUpdate={handleProgressUpdate}
        />
      );
    }

    // Video that is still processing / failed (an owner sees these), or has no playable file
    const hasParts = c.parts?.length > 0;
    if ((c.status && c.status !== "ready") || (!hasParts && !(c.video_url || c.url))) {
      return (
        <div className="p-10 text-center bg-slate-800 rounded-xl text-slate-400">
          This video is not available yet.
        </div>
      );
    }

    const player = hasParts ? (
      // A long video stored as pieces: plays as ONE video (one seek bar, one clock)
      <LessonPlayer
        key={`video-${cId}`}
        parts={c.parts}
        captionsUrl={c.captions_url}
        enrollmentId={enrollment?.enrollment_id}
        contentId={c.content_id}
        onProgressUpdate={handleProgressUpdate}
        onEnded={handleVideoEnded}
        autoPlay={autoPlayNext}
        startAt={completedContentIds.has(c.content_id) ? 0 : positions[c.content_id] || 0}
      />
    ) : (
      <VideoPlayer
        videoUrl={c.video_url || c.url}
        captionsUrl={c.captions_url}
        enrollmentId={enrollment?.enrollment_id}
        contentId={cId}
        onProgressUpdate={handleProgressUpdate}
        onEnded={handleVideoEnded}
        autoPlay={autoPlayNext}
        startAt={positions[cId] || 0}
      />
    );

    // Captions (c.captions_url, WebVTT) and a text transcript (c.transcript) show up as soon as the API provides them
    return (
      <>
        {player}
        {c.transcript && (
          <details className="mt-3 rounded-lg bg-slate-800 p-3 text-sm text-slate-200">
            <summary className="cursor-pointer font-semibold">Transcript</summary>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{c.transcript}</p>
          </details>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="min-h-16 bg-slate-800 border-b border-slate-700 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate(`/courses/${courseId}`)}
            className="shrink-0 text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition"
          >
            ← Back
          </button>
          <h1 className="min-w-0 text-base sm:text-lg font-semibold truncate">{course.title}</h1>
        </div>
        {enrollment && readyTotal > 0 && (
          <div className="w-full md:w-56 order-last md:order-none">
            <div
              role="progressbar"
              aria-label="Course progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={donePct}
              aria-valuetext={`${doneCount} of ${readyTotal} lessons completed`}
              className="h-2 bg-slate-700 rounded-full overflow-hidden"
            >
              <div className="h-full bg-emerald-500" style={{ width: `${donePct}%` }} />
            </div>
            <div className="text-xs text-slate-400 mt-1">{doneCount} of {readyTotal} lessons · {donePct}%</div>
          </div>
        )}
        <button
          onClick={() => navigate("/student/certificates")}
          className="shrink-0 text-sm bg-indigo-600 hover:bg-indigo-500 px-3 sm:px-4 py-2 rounded-lg font-medium transition"
        >
          <span className="sm:hidden">Certificates</span><span className="hidden sm:inline">My Certificates</span>
        </button>
      </header>

      {/* Main Content & Sidebar */}
      <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">
        {/* Main Video Viewport */}
        <div className="flex-1 min-w-0 p-3 sm:p-6 lg:overflow-y-auto">
          {activeContent ? (
            <div className="max-w-5xl mx-auto space-y-6">
              {renderLesson()}
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {activeContent.title}
                </h2>
                <p className="text-slate-400 mt-2">
                  {activeContent.description || "No description provided."}
                </p>
              </div>
              {nextLesson && (
                <button
                  onClick={() => {
                    setAutoPlayNext(false);
                    setActiveContent(nextLesson);
                  }}
                  className="text-sm bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg font-medium transition"
                >
                  Next lesson: {nextLesson.title} →
                </button>
              )}
              {activeModule && <ModuleComments key={activeModule.module_id} moduleId={activeModule.module_id} />}
            </div>
          ) : (
            <div className="text-center py-20 text-slate-400">
              Select a lesson from the menu to start learning.
            </div>
          )}
        </div>

        {/* Course Modules Sidebar */}
        <aside aria-label="Course content" className="w-full lg:w-96 bg-slate-800 border-t lg:border-t-0 lg:border-l border-slate-700 lg:overflow-y-auto p-4">
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
                    aria-current={isSelected ? 'true' : undefined}
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
                      <TypeBadge type={only.type} />
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
                <div className="text-sm font-semibold text-indigo-400 mb-2 flex items-baseline justify-between gap-2">
                  <span>Module {mIdx + 1}: {module.title}</span>
                  <span className="text-xs font-normal text-slate-400 shrink-0">
                    {(module.contents || []).filter((c) => completedContentIds.has(c.content_id || c.id)).length}/{(module.contents || []).length} done
                  </span>
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
                        aria-current={isSelected ? 'true' : undefined}
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
                          <TypeBadge type={content.type} />
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
