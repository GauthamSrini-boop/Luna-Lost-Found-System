import { Navigate, Route, Routes } from 'react-router-dom';
import Layout, { RequireAuth } from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import { Login, Register } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Browse from './pages/Browse.jsx';
import ReportForm from './pages/ReportForm.jsx';
import ReportDetail from './pages/ReportDetail.jsx';
import Matches from './pages/Matches.jsx';
import { ClaimsList, ClaimDetail } from './pages/Claims.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';
import { NotFound, Unauthorized } from './pages/Misc.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/report/new/:type" element={<ReportForm />} />
        <Route path="/reports/:type/:id" element={<ReportDetail />} />
        <Route path="/reports/:type/:id/edit" element={<ReportForm />} />
        <Route path="/matches" element={<Matches />} />
        <Route path="/claims" element={<ClaimsList />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
      </Route>
      <Route element={<RequireAuth roles={['admin']}><Layout /></RequireAuth>}>
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
