import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Releases from './pages/Releases';
import Publish from './pages/Publish';
import Settings from './pages/Settings';
import ISOs from './pages/ISOs';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="releases" element={<Releases />} />
        <Route path="isos" element={<ISOs />} />
        <Route path="publish" element={<Publish />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
