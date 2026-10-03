// import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
// import { AuthProvider } from './context/AuthContext';
// import Navbar from './components/Navbar';
// import ProtectedRoute from './components/ProtectedRoute';
// import Login from './pages/Login';
// import Register from './pages/Register';
// import CourseCatalog from './pages/CourseCatalog';
// import CourseDetails from './pages/CourseDetails';


// export default function App() {
//   return (
//     <AuthProvider>
//       <Router>
//         <div className="min-h-screen bg-slate-50 text-slate-900">
//           <Navbar />
//           <Routes>
//             <Route path="/" element={<CourseCatalog />} />
//             <Route path="/login" element={<Login />} />
//             <Route path="/register" element={<Register />} />
            
//             <Route element={<ProtectedRoute />}>
//               <Route path="/courses/:id" element={<CourseDetails />} />
//             </Route>
//           </Routes>
//         </div>
//       </Router>
//     </AuthProvider>
//   );
// }

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

// Auth Pages
import Login from './pages/Login';
import Register from './pages/Register';

// Day 9: Student Pages (Mapped to your exact directory tree)
import CourseCatalog from './pages/student/CourseCatalog';
import CourseDetails from './pages/CourseDetails';

// Day 7 & 8: Instructor Pages
import CourseList from './pages/instructor/CourseList';
import CreateCourse from './pages/instructor/CreateCourse';
import CourseModules from './pages/instructor/CourseModules';

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          <Navbar />
          <Routes>
            {/* Public Student Catalog & Detail Routes (Day 9) */}
            <Route path="/" element={<CourseCatalog />} />
            <Route path="/courses" element={<CourseCatalog />} />
            <Route path="/courses/:courseId" element={<CourseDetails />} />

            {/* Authentication Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Protected Instructor Routes (Day 7 & Day 8) */}
            <Route element={<ProtectedRoute allowedRoles={['instructor', 'admin']} />}>
              <Route path="/instructor/courses" element={<CourseList />} />
              <Route path="/instructor/courses/new" element={<CreateCourse />} />
              <Route path="/instructor/courses/:courseId/modules" element={<CourseModules />} />
            </Route>
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}