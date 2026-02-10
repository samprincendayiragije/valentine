import './App.css';
import Landing from './components/landingpage';
import Navbar from './components/navbar';
export default function App(){
  return(
    <div className='bg-slate-950 min-h-screen w-full'>
    <Navbar />
    <Landing />
   </div>
  )
}