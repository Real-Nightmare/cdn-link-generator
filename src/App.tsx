import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Landing from "./pages/Landing";
import Generator from "./pages/Generator";
import Seeder from "./pages/Seeder";
import Header from "./components/Header";
import Footer from "./components/Footer";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/generate" element={<Generator />} />
          <Route path="/seeder" element={<Seeder />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
