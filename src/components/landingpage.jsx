import { Heart } from "lucide-react";
import { useEffect, useState } from "react"

export default function Landing() {
    const [invite, setinvite] = useState('Would you be my valentine Diva !??')
    useEffect(() => {
        const nobutton = document.querySelector('.never');
        let text= '';
        
        for (let i = 0 ; i < invite.length ; i++){
            setTimeout(() => {
                text += invite[i];
                setinvite(text);
                console.log(invite)
            }, i*200);
        }
        
        nobutton.addEventListener('mouseenter', () => {
            nobutton.innerHTML = 'don\'t test me';
        })
        nobutton.addEventListener('mouseout', () => {
            nobutton.innerHTML = 'no';
        })
    }, [])

    return (
        <section>
            <div className="flex justify-center items-center">
                <div className="absolute inset-0">
                    <div className="w-20 h-20 rounded-full bg-white/35 blur-3xl top-0 left-20 animate-pulse relative" />
                    <div className="w-60 h-60 rounded-full bg-white/5 animate-pulse delay-100 relative sm:top-80 top-60 left-60 sm:left-240 blur-3xl" />
                </div>
                <div className="w-full h-screen flex justify-center items-center relative">
                    <div className="sm:w-250 w-60 sm:h-130 h-60 overflow-hidden bg-purple-950/15 border border-pink-500/30 sm:mb-25 rounded-2xl grid grid-cols-2 gap-2 p-10">
                        <div className="bg-white/5 text-black rounded-2xl  flex flex-col py-10 justify-between animate-in-from-bottom duration-1000">
                            <h1 id="invite" className="italic font-bold text-4xl mx-auto leading-relaxed px-8 text-center bg-gradient-to-l from-purple-800 via-purple-600 to-purple-400 bg-clip-text text-transparent ">{invite}</h1>
                            <div className="mb-6 scale-300 flex justify-center"><Heart className="fill-purple-500" /></div>
                            {/* gift tag */}
                            <div className="grid grid-cols-2 text-white justify-between items-center mx-10 gap-10">
                                <button
                                    onClick={() => {
                                        let response = prompt('i love you mi Diva ?');
                                        if (response.includes('i love you')) {
                                            alert('Mi heart Belongs to you ♥')
                                        } else {
                                            alert('unpredicted answer please give the required answer 😠😡💢');
                                        }
                                    }}
                                    className="bg-purple-950 py-1 hover:brightness-200 border animate-bounce duration-200 rounded-full cursor-pointer text-xl italic">Yes</button>
                                <button
                                    onClick={() => {
                                        if (window.confirm('am warning ya 💀 better cancel it ')) {
                                            alert('like it or not u are goin to be my valentine 😜 😑😑')
                                        } else {
                                            alert('excelent choice sweet pie ☺☺')
                                        }
                                    }}
                                    className="never bg-black py-1 hover:bg-white hover:text-black border duration-200 rounded-full cursor-pointer text-xl italic">No</button>
                            </div>
                        </div>
                        <div className="flex flex-col items-center py-5 px-15 animate-in-from-top duration-1000">
                            <div className="sm:w-40 sm:h-40 border-5 rounded-full border-rose-500 bg-[url('/eres.jpg')] bg-cover bg-center  " />
                            <h1 className="text-transparent mt-2 italic font-medium bg-gradient-to-r from-white/65 animate-pulse via-pink-500 to-purple-500 bg-clip-text text-xl">Never wanna let go of this hand</h1>
                            <div className="mt-5 px-2  text-white"><p className="text-center leading-relaxed text-algerian  text-lg text-purple-300 text-2xl">where things get weird ,rough, dispointing in whatever the world throws at us i'll be there to keep the comfort it doesn't
                                 matter whether we are good or not all i ever want is to see you happy 🙂🙂</p></div>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    )
}