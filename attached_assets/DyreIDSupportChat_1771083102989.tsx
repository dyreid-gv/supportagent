import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2, Send, User, Bot, Sparkles } from 'lucide-react';

export default function DyreIDSupportChat() {
  const [messages, setMessages] = useState([
    {
      role: 'agent',
      content: 'Hei! Jeg kan hjelpe deg med eierskifte, registrering, produkter og mer. Hva lurer du på? 🐾'
    }
  ]);
  const [input, setInput] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userContext, setUserContext] = useState(null);
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [contactMethod, setContactMethod] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Quick intent matching (før Claude API)
  const quickIntentMatch = (message) => {
    const lowerMsg = message.toLowerCase();
    
    const patterns = {
      eierskifte: {
        regex: /eierskift|selge|solgt|ny eier|overfør|kjøpt/i,
        response: `For å hjelpe deg med eierskifte trenger jeg å se hvilke dyr du har registrert. Kan jeg logge deg inn?`
      },
      login: {
        regex: /logg inn|passord|bankid|innlogg/i,
        response: 'Har du problemer med innlogging? Jeg kan hjelpe deg. Hvilken innloggingsmetode bruker du (BankID, OTP)?'
      },
      qr: {
        regex: /qr.?tag|qr.?brikke|skann|aktivere tag/i,
        response: 'Jeg kan hjelpe deg med QR Tag! Har du allerede kjøpt en, eller lurer du på hvordan den fungerer?'
      },
      savnet: {
        regex: /savnet|mistet|funnet|borte|forsvunnet/i,
        response: 'Jeg hjelper deg gjerne med savnet/funnet. For å melde dyr savnet må jeg vite hvilket dyr det gjelder. Kan jeg logge deg inn?'
      },
      registrering: {
        regex: /registrer|chip|søkbart|id.?merk/i,
        response: 'Jeg kan hjelpe med registrering! Er dyret allerede chipet, eller trenger du informasjon om ID-merking?'
      }
    };

    for (const [intent, config] of Object.entries(patterns)) {
      if (config.regex.test(lowerMsg)) {
        return { intent, response: config.response };
      }
    }
    return null;
  };

  // Verify OTP
  const verifyOTP = async (otpCode, contact) => {
    try {
      const response = await fetch('https://minside.dyreid.no/Security/ValidateOtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          contactMethod: contact,
          otpCode: otpCode 
        })
      });

      if (response.ok) {
        // Fetch user context
        const contextResponse = await fetch(
          `https://minside.dyreid.no/Security/GetOwnerDetailforOTPScreen?emailOrContactNumber=${contact}`,
          { credentials: 'include' }
        );
        
        const userData = await contextResponse.json();
        setUserContext(userData);
        setIsAuthenticated(true);
        setAwaitingOtp(false);

        return {
          success: true,
          message: `Velkommen, ${userData.FirstName || 'bruker'}! Jeg ser du har ${userData.Pets?.length || 0} registrerte dyr. Hvordan kan jeg hjelpe deg i dag?`
        };
      } else {
        return {
          success: false,
          message: 'Feil OTP-kode. Prøv igjen eller skriv "ny kode" for å få en ny.'
        };
      }
    } catch (error) {
      console.error('OTP verification error:', error);
      return {
        success: false,
        message: 'Kunne ikke verifisere koden. Prøv igjen.'
      };
    }
  };

  // Send OTP
  const sendOTP = async (contact) => {
    try {
      await fetch('https://minside.dyreid.no/Security/SendOtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactMethod: contact })
      });
      
      setContactMethod(contact);
      setAwaitingOtp(true);
      return `Jeg har sendt en engangskode til ${contact}. Vennligst skriv inn koden.`;
    } catch (error) {
      console.error('Send OTP error:', error);
      return 'Kunne ikke sende kode. Sjekk at mobilnummer/e-post er riktig.';
    }
  };

  // Get AI response (with user context)
  const getAIResponse = async (message, context) => {
    try {
      const systemPrompt = context ? `Du er DyreID supportagent.

BRUKERINFO:
Navn: ${context.FirstName}
Registrerte dyr: ${context.Pets?.map(p => `${p.Name} (${p.Species})`).join(', ')}

Bruk denne informasjonen til å gi personlige, hjelpsome svar.
Vær vennlig og proaktiv. Foreslå relevante handlinger.` : 
      `Du er DyreID supportagent. Hjelp med eierskifte, registrering, produkter og app.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }]
        })
      });

      const data = await response.json();
      return data.content[0].text;
    } catch (error) {
      console.error('AI response error:', error);
      return 'Beklager, jeg hadde problemer med å svare. Prøv igjen.';
    }
  };

  // Generate activity suggestions
  const generateSuggestions = (context) => {
    if (!context || !context.Pets) return [];
    
    const suggestions = [];
    
    // Check if pets need QR tags
    context.Pets.forEach(pet => {
      // Simplified check (would need Product API in production)
      suggestions.push({
        type: 'info',
        petName: pet.Name,
        message: `Har ${pet.Name} QR Tag for enklere gjenfinning?`,
        action: 'Bestill QR Tag',
        priority: 'medium'
      });
    });

    return suggestions.slice(0, 2); // Max 2 suggestions
  };

  // Handle message send
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      let agentResponse;

      if (awaitingOtp) {
        // User is entering OTP code
        const result = await verifyOTP(userMessage, contactMethod);
        agentResponse = result.message;

        if (result.success && userContext) {
          // Add suggestions after login
          const suggestions = generateSuggestions(userContext);
          if (suggestions.length > 0) {
            setMessages(prev => [...prev, 
              { role: 'agent', content: agentResponse },
              { role: 'suggestions', content: suggestions }
            ]);
            setLoading(false);
            return;
          }
        }
      } else {
        // Check for quick intent match first
        const quickMatch = quickIntentMatch(userMessage);
        
        if (quickMatch && quickMatch.response.includes('logge deg inn')) {
          agentResponse = quickMatch.response;
        } else if (quickMatch) {
          agentResponse = quickMatch.response;
        } else {
          // Fall back to AI
          agentResponse = await getAIResponse(userMessage, userContext);
        }

        // Check if response asks for login
        if (agentResponse.includes('logge deg inn')) {
          setMessages(prev => [...prev, 
            { role: 'agent', content: agentResponse }
          ]);
          setLoading(false);
          return;
        }
      }

      setMessages(prev => [...prev, { role: 'agent', content: agentResponse }]);
    } catch (error) {
      console.error('Send message error:', error);
      setMessages(prev => [...prev, { 
        role: 'agent', 
        content: 'Beklager, noe gikk galt. Prøv igjen.' 
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Handle login request
  const requestLogin = async () => {
    const contact = window.prompt('Skriv inn mobilnummer eller e-post:');
    if (!contact) return;

    setLoading(true);
    const response = await sendOTP(contact);
    setMessages(prev => [...prev, { role: 'agent', content: response }]);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              🐾 DyreID Support
            </h1>
            {isAuthenticated && userContext && (
              <p className="text-sm text-blue-100 mt-1">
                Logget inn som {userContext.FirstName} • {userContext.Pets?.length || 0} dyr
              </p>
            )}
          </div>
          {!isAuthenticated && (
            <Button 
              variant="secondary" 
              size="sm"
              onClick={requestLogin}
              disabled={loading}
            >
              Logg inn
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'suggestions' ? (
              <div className="space-y-2 mt-4">
                <p className="text-sm font-semibold text-gray-600 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Anbefalinger for deg:
                </p>
                {msg.content.map((s, j) => (
                  <Card key={j} className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                    <p className="text-sm mb-2">{s.message}</p>
                    <Button size="sm" variant="outline" className="text-xs">
                      {s.action}
                    </Button>
                  </Card>
                ))}
              </div>
            ) : (
              <div className={`flex items-start gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'agent' && (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-blue-600" />
                  </div>
                )}
                <Card className={`p-4 max-w-[75%] ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white border-blue-600' 
                    : 'bg-white border-gray-200'
                }`}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {msg.content}
                  </p>
                </Card>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-gray-600" />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        
        {loading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Bot className="w-5 h-5 text-blue-600" />
            </div>
            <Card className="p-4 bg-white">
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Skriver...</span>
              </div>
            </Card>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-white p-4 shadow-lg">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={awaitingOtp ? "Skriv inn OTP-kode..." : "Skriv ditt spørsmål..."}
            disabled={loading}
            className="flex-1"
          />
          <Button 
            onClick={sendMessage} 
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-2 text-center">
          AI-drevet support • Kan gjøre feil • Alltid dobbeltsjekk viktig info
        </p>
      </div>
    </div>
  );
}
