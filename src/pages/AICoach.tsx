import Markdown from 'react-markdown';
import React, { useState, useEffect, useRef } from 'react';
import { Cpu, Send, RotateCcw, X, User } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const INITIAL_MESSAGE: Message = {
    id: '1',
    role: 'assistant',
    content: `Hello! I am the **4xLifeAI Coach**, your in-app assistant here to help you trade smarter.

How can I help you level up your trading today? We can dive into:
* **Risk Management & Position Sizing** (calculating lot sizes, managing drawdowns)
* **Smart Money Concepts (SMC)** (BOS, CHoCH, Pullbacks, Liquidity)
* **Trading Psychology & Journaling**
* **4xLifeAI Plans** (from Starter to Quantum)`
};

export default function AICoach() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [usage, setUsage] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedUsage = localStorage.getItem('4xlifeai_coach_usage');
    const savedDate = localStorage.getItem('4xlifeai_coach_date');
    const today = new Date().toDateString();

    if (savedDate !== today) {
        localStorage.setItem('4xlifeai_coach_date', today);
        localStorage.setItem('4xlifeai_coach_usage', '0');
        setUsage(0);
    } else if (savedUsage) {
        setUsage(parseInt(savedUsage, 10));
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    if (usage >= 4) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '**Limit Reached**: You have used your 4/4 asks for today. Please upgrade your plan for unlimited AI coaching.'
      }]);
      setInput('');
      scrollToBottom();
      return;
    }

    const userInput = input.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput
    };
    
    // Save history without the new message 
    // omitting the system prompt
    const history = messages.filter(m => m.id !== '1');
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userInput, history })
      });
      const data = await res.json();
      
      if (data.success) {
        const aiMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: data.text
        };
        setMessages(prev => [...prev, aiMessage]);
        
        const newUsage = usage + 1;
        setUsage(newUsage);
        localStorage.setItem('4xlifeai_coach_usage', newUsage.toString());
      } else {
        let errorContent = data.error || 'Failed to connect to AI server.';
        if (typeof errorContent === 'string' && errorContent.includes('{')) {
             try {
                const parsed = JSON.parse(errorContent);
                if (parsed.error && parsed.error.message && parsed.error.message.includes('quota')) {
                     errorContent = '4xLifeAI Coach is currently experiencing high demand. Please try again in 1 minute.';
                } else if (parsed.error && parsed.error.message) {
                     errorContent = parsed.error.message;
                }
             } catch(err) {
                // Ignore parse errors
             }
        }
        
        const errorMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `**System Notice**: ${errorContent}`
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (e: any) {
        const errorMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: "**Network Error**: Unable to reach the AI Coach at this time."
        };
        setMessages(prev => [...prev, errorMessage]);
    } finally {
        setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
      setMessages([INITIAL_MESSAGE]);
  };

  return (
    <div className="flex-1 w-full bg-[#0A0D12] flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="bg-[#11141A] border-b border-[#202735] p-3 flex items-center justify-between z-10 shrink-0">
         <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-teal-500/10 border border-teal-500/20 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(20,184,166,0.2)]">
                 <Cpu className="w-5 h-5 text-teal-400" />
             </div>
             <div>
                <h1 className="text-white font-bold flex items-center gap-2">
                    4xLifeAI Coach <span className="text-pink-500 drop-shadow-[0_0_5px_rgba(236,72,153,0.5)]">🧠</span>
                </h1>
                <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-teal-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
                        Active Online
                    </span>
                    <span className="text-[#202735]">•</span>
                    <span className="text-[#8A95A5] flex items-center gap-1 bg-[#202735]/50 px-2 py-0.5 rounded">
                       <User className="w-3 h-3" /> Usage: {usage}/4 Ask
                    </span>
                </div>
             </div>
         </div>
         
         <div className="flex items-center gap-2">
             <button onClick={handleReset} className="flex items-center gap-1.5 text-[#8A95A5] hover:text-white px-3 py-1.5 text-xs font-medium transition-colors">
                 <RotateCcw className="w-3.5 h-3.5" />
                 Reset
             </button>
             <button className="p-1.5 text-[#8A95A5] hover:text-white transition-colors">
                 <X className="w-5 h-5" />
             </button>
         </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg, index) => (
             <div key={msg.id} className={cn(
                 "flex gap-4 max-w-3xl",
                 msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
             )}>
                 <div className="shrink-0 mt-1">
                     {msg.role === 'assistant' ? (
                         <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                             <Cpu className="w-4 h-4 text-teal-400" />
                         </div>
                     ) : (
                         <div className="w-8 h-8 rounded-lg bg-[#202735] flex items-center justify-center">
                             <User className="w-4 h-4 text-[#8A95A5]" />
                         </div>
                     )}
                 </div>
                 
                 <div className={cn(
                     "px-5 py-4 rounded-2xl text-sm leading-relaxed max-w-full overflow-hidden",
                     msg.role === 'user' 
                         ? "bg-blue-600 text-white rounded-tr-sm" 
                         : index === 0 
                             ? "bg-[#11141A] border border-[#202735] text-[#E0E4EA] rounded-tl-sm shadow-xl"
                             : "bg-[#11141A] text-[#E0E4EA] rounded-tl-sm"
                 )}>
                     <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-[#0A0D12] prose-pre:border prose-pre:border-[#202735] prose-li:my-0.5 prose-ul:my-2 prose-p:my-2">
                       <Markdown>{msg.content}</Markdown>
                     </div>
                 </div>
             </div>
          ))}
          
          {isTyping && (
              <div className="flex gap-4 max-w-3xl">
                 <div className="shrink-0 mt-1">
                     <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                         <Cpu className="w-4 h-4 text-teal-400" />
                     </div>
                 </div>
                 <div className="px-5 py-4 bg-[#11141A] text-[#E0E4EA] rounded-2xl rounded-tl-sm flex items-center gap-1.5 relative overflow-hidden">
                     <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                     <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                     <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                 </div>
              </div>
          )}
          <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 shrink-0 border-t border-[#202735] bg-[#0A0D12]">
          <div className="max-w-5xl mx-auto">
              <div className="relative">
                  <textarea
                     value={input}
                     onChange={(e) => setInput(e.target.value)}
                     onKeyDown={handleKeyDown}
                     placeholder="Ask Coach about SMC, risk size, psychology..."
                     className="w-full bg-[#11141A] border border-[#202735] focus:border-teal-500/50 rounded-xl pl-4 pr-12 py-3 text-sm text-white outline-none resize-none overflow-hidden h-[46px] min-h-[46px] leading-[1.6]"
                     rows={1}
                  />
                  <button 
                     onClick={handleSend}
                     disabled={!input.trim()}
                     className="absolute right-2 top-1.5 p-2 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 rounded-lg transition-colors disabled:opacity-50 disabled:bg-transparent disabled:text-[#8A95A5]"
                  >
                      <Send className="w-4 h-4" />
                  </button>
              </div>
              <p className="text-center text-[10px] text-[#5D6B80] mt-2 font-mono uppercase tracking-widest">
                  Coach signals/information involve risk. Leverage carries loss potentials.
              </p>
          </div>
      </div>
    </div>
  );
}
