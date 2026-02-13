import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Send,
  Plus,
  Trash2,
  LogIn,
  User,
  Bot,
  PawPrint,
  Shield,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";

interface Message {
  id: number;
  role: string;
  content: string;
  createdAt: string;
  metadata?: any;
}

interface Conversation {
  id: number;
  title: string;
  authenticated: boolean;
  ownerId: string | null;
  createdAt: string;
  messages?: Message[];
}

interface AuthResult {
  authenticated: boolean;
  owner: {
    ownerId: string;
    firstName: string;
    lastName: string;
  };
  animalCount: number;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      data-testid={`message-${message.id}`}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-muted"}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={`rounded-lg px-4 py-2 max-w-[80%] ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        <p className="text-xs opacity-60 mt-1">
          {new Date(message.createdAt).toLocaleTimeString("nb-NO", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

function StreamingMessage({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="flex gap-3" data-testid="message-streaming">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="bg-muted">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="rounded-lg px-4 py-2 max-w-[80%] bg-muted">
        <p className="text-sm whitespace-pre-wrap">{content}</p>
        <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
      </div>
    </div>
  );
}

export default function Chatbot() {
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authPhone, setAuthPhone] = useState("");
  const [authResult, setAuthResult] = useState<AuthResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: conversations = [], isLoading: loadingConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/chat/conversations"],
  });

  const { data: activeConversation } = useQuery<Conversation>({
    queryKey: ["/api/chat/conversations", activeConversationId],
    enabled: !!activeConversationId,
  });

  const createConversation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/chat/conversations", { title: "Ny samtale" }),
    onSuccess: async (res) => {
      const conv = await res.json();
      setActiveConversationId(conv.id);
      setAuthResult(null);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });

  const deleteConversation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/chat/conversations/${id}`),
    onSuccess: () => {
      if (activeConversationId) {
        setActiveConversationId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });

  const messages = activeConversation?.messages || [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || !activeConversationId || isSending) return;

    const content = inputValue.trim();
    setInputValue("");
    setIsSending(true);
    setStreamingContent("");

    try {
      const response = await fetch(
        `/api/chat/conversations/${activeConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                accumulated += data.content;
                setStreamingContent(accumulated);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error("Send error:", err);
    } finally {
      setIsSending(false);
      setStreamingContent("");
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations", activeConversationId],
      });
    }
  }, [inputValue, activeConversationId, isSending]);

  const handleAuth = async () => {
    if (!authPhone.trim() || !activeConversationId) return;

    try {
      const res = await apiRequest("POST", `/api/chat/conversations/${activeConversationId}/auth`, {
        phone: authPhone.trim(),
      });
      const result: AuthResult = await res.json();
      setAuthResult(result);
      setShowAuthDialog(false);
      setAuthPhone("");

      queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations", activeConversationId],
      });
    } catch (err: any) {
      alert(err.message || "Autentisering feilet");
    }
  };

  const isAuthenticated = activeConversation?.authenticated || authResult?.authenticated;

  return (
    <div className="flex h-full">
      <div className="w-64 border-r flex flex-col bg-muted/30">
        <div className="p-3 border-b">
          <Button
            className="w-full"
            onClick={() => createConversation.mutate()}
            disabled={createConversation.isPending}
            data-testid="button-new-chat"
          >
            <Plus className="h-4 w-4 mr-2" />
            Ny samtale
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`flex items-center justify-between gap-1 p-2 rounded-md cursor-pointer hover-elevate ${
                  activeConversationId === conv.id ? "bg-accent" : ""
                }`}
                onClick={() => {
                  setActiveConversationId(conv.id);
                  setAuthResult(null);
                }}
                data-testid={`conversation-${conv.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm truncate">{conv.title}</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                  style={{ visibility: "hidden" }}
                  onMouseEnter={(e) => (e.currentTarget.style.visibility = "visible")}
                  onMouseLeave={(e) => (e.currentTarget.style.visibility = "hidden")}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation.mutate(conv.id);
                  }}
                  data-testid={`button-delete-${conv.id}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col">
        {!activeConversationId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
              <PawPrint className="h-16 w-16 mx-auto text-primary/40" />
              <h2 className="text-xl font-semibold" data-testid="text-welcome">
                DyreID Support
              </h2>
              <p className="text-muted-foreground">
                Velkommen til DyreID sin intelligente support-assistent. Start en ny samtale for å
                få hjelp med registrering, eierskifte, QR-brikker og mer.
              </p>
              <Button
                onClick={() => createConversation.mutate()}
                disabled={createConversation.isPending}
                data-testid="button-start-chat"
              >
                <Plus className="h-4 w-4 mr-2" />
                Start ny samtale
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 p-3 border-b flex-wrap">
              <div className="flex items-center gap-2">
                <PawPrint className="h-5 w-5 text-primary" />
                <span className="font-medium">DyreID Support</span>
              </div>
              <div className="flex items-center gap-2">
                {isAuthenticated ? (
                  <Badge data-testid="badge-authenticated">
                    <Shield className="h-3 w-3 mr-1" />
                    Innlogget
                    {authResult?.owner
                      ? `: ${authResult.owner.firstName} ${authResult.owner.lastName}`
                      : ""}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAuthDialog(true)}
                    data-testid="button-login"
                  >
                    <LogIn className="h-4 w-4 mr-1" />
                    Logg inn (OTP)
                  </Button>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.length === 0 && !streamingContent && (
                  <div className="text-center py-8">
                    <Bot className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-muted-foreground text-sm">
                      Hei! Jeg er DyreID sin support-assistent. Hva kan jeg hjelpe deg med?
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mt-4">
                      {[
                        "Jeg vil eierskifte hunden min",
                        "QR-brikken min virker ikke",
                        "Dyret mitt er ikke søkbart",
                        "Hunden min er savnet",
                      ].map((q) => (
                        <Button
                          key={q}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setInputValue(q);
                            inputRef.current?.focus();
                          }}
                          data-testid={`button-suggestion-${q.slice(0, 15).replace(/\s/g, "-")}`}
                        >
                          {q}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}

                {streamingContent && <StreamingMessage content={streamingContent} />}

                {isSending && !streamingContent && (
                  <div className="flex gap-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-muted">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="rounded-lg px-4 py-2 bg-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="p-3 border-t">
              <div className="flex gap-2 max-w-3xl mx-auto">
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Skriv din melding..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  disabled={isSending}
                  data-testid="input-message"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!inputValue.trim() || isSending}
                  data-testid="button-send"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={showAuthDialog} onOpenChange={setShowAuthDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Logg inn med OTP</DialogTitle>
            <DialogDescription>
              For demo: bruk telefonnummer 91000001-91000005
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={authPhone}
              onChange={(e) => setAuthPhone(e.target.value)}
              placeholder="Telefonnummer"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAuth();
              }}
              data-testid="input-auth-phone"
            />
            <Button
              className="w-full"
              onClick={handleAuth}
              disabled={!authPhone.trim()}
              data-testid="button-auth-submit"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Logg inn
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
