import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
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
  Sparkles,
  KeyRound,
  ThumbsUp,
  ThumbsDown,
  MinusCircle,
  CheckCircle2,
  Zap,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

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
  userContext?: UserContext | null;
  createdAt: string;
  messages?: Message[];
}

interface UserContext {
  FirstName: string;
  LastName?: string;
  Email?: string;
  Phone?: string;
  OwnerId?: string;
  NumberOfPets?: number;
  Pets?: { Name: string; Species: string; Breed?: string; AnimalId?: string; ChipNumber?: string }[];
}

function FeedbackWidget({ interactionId, existingFeedback }: { interactionId: number; existingFeedback?: string | null }) {
  const [submitted, setSubmitted] = useState<string | null>(existingFeedback || null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitFeedback = async (result: string) => {
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/feedback", { interactionId, result, comment: comment || undefined });
      setSubmitted(result);
      setShowComment(false);
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/flagged"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/interactions"] });
    } catch (err) {
      console.error("Feedback error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5">
        <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {submitted === "resolved" ? "Hjelpsomt" : submitted === "partial" ? "Delvis hjelpsomt" : "Ikke hjelpsomt"}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground mr-1">Var dette nyttig?</span>
        <Button
          size="icon"
          variant="ghost"
          className="toggle-elevate"
          onClick={() => submitFeedback("resolved")}
          disabled={submitting}
          data-testid={`button-feedback-resolved-${interactionId}`}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="toggle-elevate"
          onClick={() => setShowComment(true)}
          disabled={submitting}
          data-testid={`button-feedback-partial-${interactionId}`}
        >
          <MinusCircle className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="toggle-elevate"
          onClick={() => setShowComment(true)}
          disabled={submitting}
          data-testid={`button-feedback-not-resolved-${interactionId}`}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </Button>
      </div>
      {showComment && (
        <div className="space-y-1.5">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Fortell oss mer (valgfritt)..."
            className="text-xs resize-none"
            rows={2}
            data-testid={`input-feedback-comment-${interactionId}`}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => submitFeedback("partial")}
              disabled={submitting}
              data-testid={`button-submit-partial-${interactionId}`}
            >
              Delvis hjelpsomt
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => submitFeedback("not_resolved")}
              disabled={submitting}
              data-testid={`button-submit-not-resolved-${interactionId}`}
            >
              Ikke hjelpsomt
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowComment(false)}
              disabled={submitting}
            >
              Avbryt
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, onSuggestionClick }: { message: Message; onSuggestionClick?: (text: string) => void }) {
  const isUser = message.role === "user";
  const interactionId = message.metadata?.interactionId as number | undefined;
  const actionExecuted = message.metadata?.actionExecuted;
  const actionSuccess = message.metadata?.actionSuccess;
  const helpCenterLink = message.metadata?.helpCenterLink as string | undefined;
  const suggestions = message.metadata?.suggestions as { label: string; action: string; data?: any }[] | undefined;

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
      <div className="max-w-[80%] space-y-2">
        <div
          className={`rounded-lg px-4 py-2 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          {!isUser && actionExecuted && (
            <div className={`flex items-center gap-1.5 mb-1.5 text-xs font-medium ${actionSuccess ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid={`status-action-${message.id}`}>
              {actionSuccess ? <Zap className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {actionSuccess ? "Handling utfort" : "Handling feilet"}
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          {helpCenterLink && (
            <a
              href={helpCenterLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs mt-1.5 underline hover:no-underline text-muted-foreground"
              data-testid={`link-helpcenter-${message.id}`}
            >
              <ExternalLink className="h-3 w-3" />
              Les mer pa hjelpesenter
            </a>
          )}
          <p className="text-xs opacity-60 mt-1">
            {new Date(message.createdAt).toLocaleTimeString("nb-NO", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {!isUser && interactionId && (
            <FeedbackWidget interactionId={interactionId} />
          )}
        </div>
        {!isUser && suggestions && suggestions.length > 0 && onSuggestionClick && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.filter(s => s.action === "SELECT_PET" || s.action === "SELECT_TAG").map((s, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                onClick={() => {
                  if (s.data?.petId) {
                    onSuggestionClick(`${s.data.petName || s.label}`);
                  } else if (s.data?.tagId) {
                    onSuggestionClick(s.data.tagId);
                  } else {
                    onSuggestionClick(s.label);
                  }
                }}
                data-testid={`button-suggestion-${message.id}-${i}`}
              >
                {s.label}
              </Button>
            ))}
            {suggestions.filter(s => s.action === "OPEN_ARTICLE" && s.data?.url).map((s, i) => (
              <a
                key={`article-${i}`}
                href={s.data.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`link-article-${message.id}-${i}`}
              >
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  {s.label}
                </Button>
              </a>
            ))}
          </div>
        )}
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

function TypingIndicator() {
  return (
    <div className="flex gap-3" data-testid="typing-indicator">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="bg-muted">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="rounded-lg px-4 py-3 bg-muted">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-xs text-muted-foreground">Skriver...</span>
        </div>
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
  const [authStep, setAuthStep] = useState<"phone" | "otp">("phone");
  const [otpCode, setOtpCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [minsideUserId, setMinsideUserId] = useState<string | null>(null);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
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
      setUserContext(null);
      setShowSuggestions(true);
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
    if (activeConversation?.authenticated && activeConversation.userContext && !userContext) {
      setUserContext(activeConversation.userContext as UserContext);
    }
  }, [activeConversation]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const doSend = useCallback(async (content: string) => {
    if (!content.trim() || !activeConversationId || isSending) return;

    setInputValue("");
    setIsSending(true);
    setStreamingContent("");
    setShowSuggestions(false);

    try {
      const response = await fetch(
        `/api/chat/conversations/${activeConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: content.trim() }),
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
  }, [activeConversationId, isSending]);

  const sendMessage = useCallback(() => {
    doSend(inputValue);
  }, [inputValue, doSend]);

  const sendDirectMessage = useCallback((text: string) => {
    doSend(text);
  }, [doSend]);

  const handleSendOtp = async () => {
    if (!authPhone.trim()) return;
    setAuthLoading(true);
    setAuthError("");

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactMethod: authPhone.trim() }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setAuthStep("otp");
        if (data.userId) {
          setMinsideUserId(data.userId);
        }
        if (data.mode === "sandbox") {
          setAuthError("Sandbox-modus: skriv inn vilkarlig kode (f.eks. 123456)");
        }
      } else {
        setAuthError(data.error || "Kunne ikke sende OTP");
      }
    } catch (err: any) {
      setAuthError("Nettverksfeil - pruv igjen");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim()) return;
    setAuthLoading(true);
    setAuthError("");

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactMethod: authPhone.trim(),
          otpCode: otpCode.trim(),
          conversationId: activeConversationId?.toString(),
          userId: minsideUserId,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setUserContext(data.userContext);
        setShowAuthDialog(false);
        setAuthStep("phone");
        setAuthPhone("");
        setOtpCode("");
        queryClient.invalidateQueries({
          queryKey: ["/api/chat/conversations", activeConversationId],
        });
      } else {
        setAuthError(data.error || "Feil OTP-kode. Pruv igjen.");
      }
    } catch (err: any) {
      setAuthError("Nettverksfeil - pruv igjen");
    } finally {
      setAuthLoading(false);
    }
  };

  const resetAuthDialog = () => {
    setShowAuthDialog(false);
    setAuthStep("phone");
    setAuthPhone("");
    setOtpCode("");
    setAuthError("");
    setAuthLoading(false);
    setMinsideUserId(null);
  };

  const isAuthenticated = activeConversation?.authenticated || !!userContext;

  const suggestedQuestions = [
    "Hvordan foreta eierskifte?",
    "Aktivere QR Tag",
    "Melde dyr savnet",
    "Problemer med innlogging",
    "Registrere nytt dyr",
    "Abonnement og priser",
  ];

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
                  setUserContext(conv.userContext || null);
                  setShowSuggestions(true);
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
                Velkommen til DyreID sin intelligente support-assistent. Start en ny samtale for a
                fa hjelp med registrering, eierskifte, QR-brikker og mer.
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
                    {userContext
                      ? `: ${userContext.FirstName}${userContext.LastName ? ` ${userContext.LastName}` : ""}`
                      : ""}
                    {userContext?.Pets && userContext.Pets.length > 0
                      ? ` (${userContext.Pets.length} dyr)`
                      : userContext?.NumberOfPets
                        ? ` (${userContext.NumberOfPets} dyr)`
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
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    onSuggestionClick={(text) => {
                      sendDirectMessage(text);
                    }}
                  />
                ))}

                {streamingContent && <StreamingMessage content={streamingContent} />}

                {isSending && !streamingContent && <TypingIndicator />}
              </div>
            </ScrollArea>

            {showSuggestions && messages.length === 0 && (
              <div className="px-4 pb-2">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-medium">Vanlige sporsmal:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestedQuestions.map((q) => (
                      <Button
                        key={q}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setInputValue(q);
                          setShowSuggestions(false);
                          inputRef.current?.focus();
                        }}
                        data-testid={`button-suggestion-${q.slice(0, 15).replace(/\s/g, "-")}`}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

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

      <Dialog open={showAuthDialog} onOpenChange={(open) => { if (!open) resetAuthDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {authStep === "phone" ? "Logg inn med OTP" : "Skriv inn engangskode"}
            </DialogTitle>
            <DialogDescription>
              {authStep === "phone"
                ? "Skriv inn mobilnummer eller e-post for a motta en engangskode. For demo: bruk 91000001-91000005."
                : `En engangskode er sendt til ${authPhone}. Skriv den inn nedenfor.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {authStep === "phone" ? (
              <>
                <Input
                  value={authPhone}
                  onChange={(e) => setAuthPhone(e.target.value)}
                  placeholder="Mobilnummer eller e-post"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSendOtp(); }}
                  disabled={authLoading}
                  data-testid="input-auth-phone"
                />
                <Button
                  className="w-full"
                  onClick={handleSendOtp}
                  disabled={!authPhone.trim() || authLoading}
                  data-testid="button-send-otp"
                >
                  {authLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send engangskode
                </Button>
              </>
            ) : (
              <>
                <Input
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="Skriv inn engangskode"
                  onKeyDown={(e) => { if (e.key === "Enter") handleVerifyOtp(); }}
                  disabled={authLoading}
                  data-testid="input-otp-code"
                />
                <Button
                  className="w-full"
                  onClick={handleVerifyOtp}
                  disabled={!otpCode.trim() || authLoading}
                  data-testid="button-verify-otp"
                >
                  {authLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4 mr-2" />
                  )}
                  Verifiser kode
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { setAuthStep("phone"); setOtpCode(""); setAuthError(""); }}
                  disabled={authLoading}
                  data-testid="button-back-to-phone"
                >
                  Tilbake
                </Button>
              </>
            )}
            {authError && (
              <p className="text-sm text-destructive" data-testid="text-auth-error">{authError}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
