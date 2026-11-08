import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Prep Orbit AI — SAT practice. Human connection.',description:'Practice SAT Math and Reading & Writing, explore community tutoring, and discover recognition for tutors who give back.',icons:{icon:'/logo-mark.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
