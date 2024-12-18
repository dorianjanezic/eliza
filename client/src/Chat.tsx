import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/context/WalletContext";
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type Attachment = {
    id: string;
    url: string;
    source: string;
    description?: string;
    title?: string;
    text?: string;
};

type TextResponse = {
    text: string;
    user: string;
    attachments?: Attachment[];
    action?: string;
};

const formatPublicKey = (key: string | null): string => {
    if (!key) return "unknown";
    return `${key.slice(0, 4).toLowerCase()}...${key.slice(-4).toLowerCase()}`;
};

export default function Chat() {
    const { connected, publicKey } = useWallet();
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<TextResponse[]>([]);
    const [loadingDots, setLoadingDots] = useState("");

    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!connected) {
            setMessages([]);
        }
    }, [connected, publicKey]);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    const mutation = useMutation({
        mutationFn: async (text: string) => {
            const res = await fetch(
                `${API_URL.replace(/\/$/, '')}/bfcb1db4-c738-0c4c-b9a2-b2e6247d6347/message`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        text,
                        userId: publicKey,
                        roomId: "meme-generation-frontend",
                    }),
                }
            );
            const data = (await res.json()) as TextResponse[];
            return data;
        },
        onSuccess: (data) => {
            setMessages((prev) => [...prev, ...data]);
            setLoadingDots("");
        },
    });

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (mutation.isPending) {
            interval = setInterval(() => {
                setLoadingDots((prev) => (prev === "..." ? "." : prev + "."));
            }, 500);
        }
        return () => clearInterval(interval);
    }, [mutation.isPending]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !publicKey) return;

        const userMessage: TextResponse = {
            text: input,
            user: publicKey,
        };
        setMessages((prev) => [...prev, userMessage]);

        mutation.mutate(input);
        setInput("");
    };

    return (
        <div className="w-[80%] h-[75vh] flex items-center">
            <div className="bg-black/70 backdrop-blur-sm rounded-lg w-full h-full p-6 shadow-2xl border border-zinc-800/50 text-white font-mono">
                <div className="flex flex-col h-full">
                    {/* Messages - now includes system message */}
                    <div
                        className="h-full overflow-y-auto overflow-x-hidden"
                        ref={chatContainerRef}
                    >
                        {/* System Message */}
                        <div className="mb-2">
                            <p>
                                <span className="text-[#EC4899]">
                                    meme_father {">"}{" "}
                                </span>
                                You come to me, on this day of maximum market
                                volatility, asking for alpha?
                            </p>
                        </div>

                        {/* All Messages in Order */}
                        {messages.map((message, index) => {
                            const tickerText = message.attachments?.[0]?.text || message.text;
                            const tickerMatch = tickerText?.match(/Meme Ticker: (\w+)/);
                            const ticker = tickerMatch ? tickerMatch[1] : null;

                            return (
                                <div key={index}>
                                    {/* Regular Message */}
                                    <div className="mb-2">
                                        <p>
                                            <span className="text-[#EC4899]">
                                                {message.user === publicKey
                                                    ? formatPublicKey(message.user)
                                                    : "meme_father"}{" "}
                                                {">"}{" "}
                                            </span>
                                            {message.text}
                                        </p>
                                    </div>

                                    {/* Meme Response if applicable */}
                                    {message.action === "CREATE_MEME_RESPONSE" && (
                                        <div className="mb-4 p-4 bg-black/20 border border-zinc-800/50 rounded-lg shadow-xl sparkle-animation">
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-2 flex-1">
                                                    <p className="text-lg font-bold text-[#EC4899]">
                                                        {message.attachments?.[0]?.title || "New Meme"}
                                                    </p>
                                                    <p className="text-sm text-zinc-400">
                                                        {message.attachments?.[0]?.description}
                                                    </p>
                                                    {ticker && (
                                                        <p className="text-sm text-green-500">
                                                            Ticker: ${ticker}
                                                        </p>
                                                    )}
                                                </div>
                                                {message.attachments?.[0]?.url && (
                                                    <img
                                                        src={`${API_URL}${message.attachments[0].url}`}
                                                        alt={message.attachments[0].title}
                                                        className="w-24 h-24 object-cover rounded-lg ml-4"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {mutation.isPending && (
                            <p>
                                <span className="text-[#EC4899]">
                                    meme_father {">"}{" "}
                                </span>
                                {loadingDots}
                            </p>
                        )}
                    </div>

                    {/* Input */}
                    <form onSubmit={handleSubmit} className="flex items-center">
                        <span className="text-[#EC4899]">
                            {formatPublicKey(publicKey)} {">"}{" "}
                        </span>
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message..."
                            className="flex-1 bg-transparent border-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-white"
                            disabled={mutation.isPending}
                        />
                    </form>
                </div>
            </div>
        </div>
    );
}
