import {createRoot} from 'react-dom/client';
import LandingPage from './LandingPage';
import './styles.css';

// Preserve bookmarks and reset links from before the public homepage was added.
const studyRoutes=new Set(['dashboard','practice','test','review','plan','tutor','analysis','adaptive','work','pacing','similar','weekly','handwriting','assistant','admin']);
const openLegacyRoute=()=>{
  const route=location.hash.slice(1);
  if(studyRoutes.has(route)||route.startsWith('reset=')) {
    location.replace(`/app/${location.search}${location.hash}`);
    return true;
  }
  return false;
};
if(!openLegacyRoute())createRoot(document.getElementById('root')!).render(<LandingPage/>);
window.addEventListener('hashchange',openLegacyRoute);
