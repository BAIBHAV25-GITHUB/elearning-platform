import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastProvider } from './components/common/Toast';
import { ConfirmProvider } from './components/common/Confirm';
import { LoadingState } from './components/common/States';

// Auth Pages
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));

// Day 9: Student Pages (Mapped to your exact directory tree)
const CourseCatalog = lazy(() => import('./pages/student/CourseCatalog'));
const CourseDetails = lazy(() => import('./pages/CourseDetails'));

// Day 7 & 8: Instructor Pages
const CourseList = lazy(() => import('./pages/instructor/CourseList'));
const CreateCourse = lazy(() => import('./pages/instructor/CreateCourse'));
const EditCourse = lazy(() => import('./pages/instructor/EditCourse'));
const CourseModules = lazy(() => import('./pages/instructor/CourseModules'));
const Analytics = lazy(() => import('./pages/instructor/Analytics'));
const CoursePlayer = lazy(() => import('./pages/student/CoursePlayer'));
const Certificates = lazy(() => import('./pages/student/Certificates'));
const CertificateView = lazy(() => import('./pages/student/CertificateView'));
const MyLearning = lazy(() => import('./pages/student/MyLearning'));

// Admin area
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminCourses = lazy(() => import('./pages/admin/Courses'));
const AdminAuditLog = lazy(() => import('./pages/admin/AuditLog'));
const AdminPayments = lazy(() => import('./pages/admin/Payments'));
const VerifyCertificate = lazy(() => import('./pages/VerifyCertificate'));
const NotFound = lazy(() => import('./pages/NotFound'));

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <ConfirmProvider>
      <Router>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          <Navbar />
          <main id="main">
          <Suspense fallback={<LoadingState />}>
          <Routes>
            {/* Public Student Catalog & Detail Routes (Day 9) */}
            <Route path="/" element={<CourseCatalog />} />
            <Route path="/courses" element={<CourseCatalog />} />
            <Route path="/courses/:courseId" element={<CourseDetails />} />
            <Route path="/verify/:code" element={<VerifyCertificate />} />

            {/* Authentication Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Protected Instructor Routes (Day 7 & Day 8) */}
            <Route element={<ProtectedRoute allowedRoles={['instructor', 'admin']} />}>
              <Route path="/instructor/courses" element={<CourseList />} />
              <Route path="/instructor/courses/new" element={<CreateCourse />} />
              <Route path="/instructor/courses/:courseId/edit" element={<EditCourse />} />
              <Route path="/instructor/courses/:courseId/modules" element={<CourseModules />} />
              <Route path="/instructor/analytics" element={<Analytics />} />
            </Route>

            {/* Protected Admin Routes: role decides the area, the server re-checks on every call */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/courses" element={<AdminCourses />} />
                <Route path="/admin/payments" element={<AdminPayments />} />
                <Route path="/admin/audit-log" element={<AdminAuditLog />} />
              </Route>
            </Route>

            {/* Protected Student Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/learn/:courseId" element={<CoursePlayer />} />
              <Route path="/student/certificates" element={<Certificates />} />
              <Route path="/student/certificates/:certificateId" element={<CertificateView />} />
              <Route path="/my-learning" element={<MyLearning />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </main>
        </div>
      </Router>
      </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}