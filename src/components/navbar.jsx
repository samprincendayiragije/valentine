export default function Navbar() {
    const date=1402;
    return(
        <nav>
            <div className="w-full py-4 sm:px-6 px-4 flex items-center justify-between text-white">
                <h1 className="text-4xl font-medium bg-gradient-to-b from-purple-500 via-white/70 to-pink-600 bg-clip-text text-transparent italic">ERES MIO</h1>
                <h2 className="text-xl font-medium bg-gradient-to-b from-purple-900 to-pink-300 bg-clip-text text-transparent italic">{(date/100).toFixed(2)}</h2>
            </div>
        </nav>
    )
}