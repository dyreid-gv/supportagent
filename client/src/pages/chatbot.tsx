import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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
  LogOut,
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
  Dog,
  Cat,
  Heart,
  Phone,
  Mail,
  Tag,
  CreditCard,
  ArrowRightLeft,
  QrCode,
  Search,
  MapPin,
  Users,
  HelpCircle,
  Smartphone,
  Globe,
  ChevronRight,
  Clock,
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
  Pets?: PetInfo[];
}

interface PetInfo {
  Name: string;
  Species: string;
  Breed?: string;
  AnimalId?: string;
  PetId?: string;
  ChipNumber?: string;
  DateOfBirth?: string;
  Gender?: string;
}

function getSpeciesIcon(species: string) {
  const s = (species || "").toLowerCase();
  if (s.includes("hund") || s.includes("dog")) return Dog;
  if (s.includes("katt") || s.includes("cat")) return Cat;
  return PawPrint;
}

function getIntentIcon(intent?: string) {
  if (!intent) return HelpCircle;
  const i = intent.toLowerCase();
  if (i.includes("ownership") || i.includes("eierskift")) return ArrowRightLeft;
  if (i.includes("qr") || i.includes("tag") || i.includes("smart")) return QrCode;
  if (i.includes("lost") || i.includes("savnet")) return Search;
  if (i.includes("found") || i.includes("funnet")) return MapPin;
  if (i.includes("family") || i.includes("deling")) return Users;
  if (i.includes("login") || i.includes("logg")) return LogIn;
  if (i.includes("app")) return Smartphone;
  if (i.includes("foreign") || i.includes("utland")) return Globe;
  if (i.includes("payment") || i.includes("pris") || i.includes("subscription")) return CreditCard;
  if (i.includes("pet") || i.includes("dyr")) return PawPrint;
  return HelpCircle;
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
      <div className="flex items-center gap-1.5 mt-2">
        <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {submitted === "resolved" ? "Hjelpsomt" : submitted === "partial" ? "Delvis hjelpsomt" : "Ikke hjelpsomt"}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
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
        <div className="space-y-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Fortell oss mer (valgfritt)..."
            className="text-xs resize-none"
            rows={2}
            data-testid={`input-feedback-comment-${interactionId}`}
          />
          <div className="flex gap-2 flex-wrap">
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

function PetCard({ pet, onClick, compact }: { pet: PetInfo; onClick?: () => void; compact?: boolean }) {
  const SpeciesIcon = getSpeciesIcon(pet.Species);
  const petId = pet.PetId || pet.AnimalId;

  if (compact) {
    return (
      <Button
        variant="outline"
        className="justify-start gap-2"
        onClick={onClick}
        data-testid={`button-select-pet-${petId}`}
      >
        <SpeciesIcon className="h-4 w-4" />
        <span>{pet.Name}</span>
        {pet.Breed && <span className="text-muted-foreground text-xs">({pet.Breed})</span>}
      </Button>
    );
  }

  return (
    <Card className="hover-elevate cursor-pointer" onClick={onClick} data-testid={`card-pet-${petId}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <SpeciesIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{pet.Name}</span>
              <Badge className="no-default-hover-elevate no-default-active-elevate text-xs">
                {pet.Species}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
              {pet.Breed && <span>{pet.Breed}</span>}
              {pet.Gender && <span>{pet.Gender}</span>}
              {pet.ChipNumber && (
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {pet.ChipNumber}
                </span>
              )}
            </div>
          </div>
          {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
      </CardContent>
    </Card>
  );
}

function PetListDisplay({ pets }: { pets: PetInfo[] }) {
  if (!pets || pets.length === 0) return null;

  return (
    <div className="space-y-2 mt-2">
      <div className="flex items-center gap-2">
        <PawPrint className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Dine registrerte dyr ({pets.length})</span>
      </div>
      <div className="grid gap-2">
        {pets.map((pet, i) => (
          <PetCard key={pet.PetId || pet.AnimalId || i} pet={pet} />
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onSuggestionClick,
  onLoginClick,
  userContext,
}: {
  message: Message;
  onSuggestionClick?: (text: string) => void;
  onLoginClick?: () => void;
  userContext?: UserContext | null;
}) {
  const isUser = message.role === "user";
  const interactionId = message.metadata?.interactionId as number | undefined;
  const actionExecuted = message.metadata?.actionExecuted;
  const actionSuccess = message.metadata?.actionSuccess;
  const actionType = message.metadata?.actionType;
  const helpCenterLink = message.metadata?.helpCenterLink as string | undefined;
  const suggestions = message.metadata?.suggestions as { label: string; action: string; data?: any }[] | undefined;
  const requiresLogin = message.metadata?.requiresLogin;
  const matchedIntent = message.metadata?.matchedIntent || message.metadata?.intent;

  const ActionIcon = getIntentIcon(matchedIntent);

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      data-testid={`message-${message.id}`}
    >
      <Avatar className="h-8 w-8 shrink-0 mt-1">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-muted"}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={`max-w-[80%] space-y-2 ${isUser ? "items-end" : ""}`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-md"
              : "bg-muted rounded-tl-md"
          }`}
        >
          {!isUser && actionExecuted && (
            <div className={`flex items-center gap-1.5 mb-2 text-xs font-medium ${actionSuccess ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid={`status-action-${message.id}`}>
              {actionSuccess ? <Zap className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {actionSuccess ? "Handling utfort" : "Handling feilet"}
              {actionType && (
                <Badge className="ml-1 no-default-hover-elevate no-default-active-elevate text-xs">
                  {actionType}
                </Badge>
              )}
            </div>
          )}
          {!isUser && matchedIntent && !actionExecuted && (
            <div className="flex items-center gap-1.5 mb-2">
              <ActionIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{matchedIntent}</span>
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
          {helpCenterLink && (
            <a
              href={helpCenterLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs mt-2 underline hover:no-underline text-muted-foreground"
              data-testid={`link-helpcenter-${message.id}`}
            >
              <ExternalLink className="h-3 w-3" />
              Les mer pa hjelpesenter
            </a>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Clock className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground/60">
              {new Date(message.createdAt).toLocaleTimeString("nb-NO", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
        {!isUser && requiresLogin && onLoginClick && (
          <Button
            variant="outline"
            size="sm"
            onClick={onLoginClick}
            className="gap-2"
            data-testid={`button-inline-login-${message.id}`}
          >
            <LogIn className="h-4 w-4" />
            Logg inn med Min Side
          </Button>
        )}
        {!isUser && suggestions && suggestions.length > 0 && onSuggestionClick && (
          <div className="flex flex-wrap gap-2">
            {suggestions.filter(s => s.action === "SELECT_PET" || s.action === "SELECT_TAG").map((s, i) => {
              const SugIcon = s.action === "SELECT_PET" ? PawPrint : Tag;
              return (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
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
                  <SugIcon className="h-3.5 w-3.5" />
                  {s.label}
                </Button>
              );
            })}
            {suggestions.filter(s => s.action === "OPEN_ARTICLE" && s.data?.url).map((s, i) => (
              <a
                key={`article-${i}`}
                href={s.data.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`link-article-${message.id}-${i}`}
              >
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {s.label}
                </Button>
              </a>
            ))}
          </div>
        )}
        {!isUser && interactionId && (
          <FeedbackWidget interactionId={interactionId} />
        )}
      </div>
    </div>
  );
}

function StreamingMessage({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="flex gap-3" data-testid="message-streaming">
      <Avatar className="h-8 w-8 shrink-0 mt-1">
        <AvatarFallback className="bg-muted">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="rounded-2xl rounded-tl-md px-4 py-3 max-w-[80%] bg-muted">
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
        <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse ml-0.5 rounded-sm" />
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3" data-testid="typing-indicator">
      <Avatar className="h-8 w-8 shrink-0 mt-1">
        <AvatarFallback className="bg-muted">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-muted">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-xs text-muted-foreground">Skriver...</span>
        </div>
      </div>
    </div>
  );
}

function AuthPanel({
  userContext,
  onLogout,
}: {
  userContext: UserContext;
  onLogout: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-green-500/10 p-1.5">
            <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm font-medium" data-testid="text-user-name">
              {userContext.FirstName} {userContext.LastName || ""}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {userContext.Phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {userContext.Phone}
                </span>
              )}
              {userContext.Email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {userContext.Email}
                </span>
              )}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onLogout}
          className="gap-1.5 text-destructive"
          data-testid="button-logout"
        >
          <LogOut className="h-3.5 w-3.5" />
          Logg ut
        </Button>
      </div>
      {userContext.Pets && userContext.Pets.length > 0 && (
        <PetListDisplay pets={userContext.Pets} />
      )}
    </div>
  );
}

const QUICK_ACTIONS = [
  { label: "Eierskifte", icon: ArrowRightLeft, query: "Hvordan foreta eierskifte?" },
  { label: "Aktivere QR Tag", icon: QrCode, query: "Aktivere QR Tag" },
  { label: "Melde savnet", icon: Search, query: "Melde dyr savnet" },
  { label: "Mine dyr", icon: PawPrint, query: "Vis mine dyr" },
  { label: "Priser", icon: CreditCard, query: "Abonnement og priser" },
  { label: "Smart Tag", icon: Tag, query: "Aktivere Smart Tag" },
];

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
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });

  const deleteConversation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/chat/conversations/${id}`),
    onSuccess: (_res, id) => {
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setUserContext(null);
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

  const handleLogout = async () => {
    if (!activeConversationId) return;
    try {
      await apiRequest("POST", `/api/chat/conversations/${activeConversationId}/logout`);
      setUserContext(null);
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations", activeConversationId],
      });
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleEndChat = async () => {
    if (!activeConversationId) return;
    if (userContext) {
      try {
        await apiRequest("POST", `/api/chat/conversations/${activeConversationId}/logout`);
      } catch {}
    }
    setActiveConversationId(null);
    setUserContext(null);
  };

  const isAuthenticated = activeConversation?.authenticated || !!userContext;

  return (
    <div className="flex h-full" data-testid="chatbot-container">
      <div className="w-72 border-r flex flex-col bg-muted/20">
        <div className="p-3 border-b">
          <Button
            className="w-full gap-2"
            onClick={() => createConversation.mutate()}
            disabled={createConversation.isPending}
            data-testid="button-new-chat"
          >
            <Plus className="h-4 w-4" />
            Ny samtale
          </Button>
        </div>

        {isAuthenticated && userContext && activeConversationId && (
          <div className="p-3 border-b">
            <AuthPanel userContext={userContext} onLogout={handleLogout} />
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {loadingConversations && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center justify-between gap-1 p-2.5 rounded-md cursor-pointer hover-elevate ${
                  activeConversationId === conv.id ? "bg-accent" : ""
                }`}
                onClick={() => {
                  setActiveConversationId(conv.id);
                  setUserContext(conv.userContext as UserContext || null);
                }}
                data-testid={`conversation-${conv.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <span className="text-sm truncate block">{conv.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(conv.createdAt).toLocaleDateString("nb-NO")}
                    </span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  style={{ visibility: "hidden" }}
                  onMouseEnter={(e) => (e.currentTarget.style.visibility = "visible")}
                  onMouseLeave={(e) => (e.currentTarget.style.visibility = "hidden")}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation.mutate(conv.id);
                  }}
                  data-testid={`button-delete-${conv.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!activeConversationId ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center space-y-6 max-w-lg">
              <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4">
                <PawPrint className="h-12 w-12 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold mb-2" data-testid="text-welcome">
                  DyreID Support
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Velkommen! Jeg hjelper deg med alt fra registrering og eierskifte til QR-brikker og Min Side.
                  Start en samtale for a komme i gang.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {QUICK_ACTIONS.map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    className="flex-col gap-2 h-auto py-3"
                    onClick={() => {
                      createConversation.mutate();
                    }}
                    data-testid={`button-quick-${action.label.replace(/\s/g, "-")}`}
                  >
                    <action.icon className="h-5 w-5 text-primary" />
                    <span className="text-xs">{action.label}</span>
                  </Button>
                ))}
              </div>
              <Button
                size="lg"
                onClick={() => createConversation.mutate()}
                disabled={createConversation.isPending}
                className="gap-2"
                data-testid="button-start-chat"
              >
                <MessageSquare className="h-5 w-5" />
                Start ny samtale
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 p-3 border-b flex-wrap">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <span className="font-medium text-sm">DyreID Support</span>
                  <span className="text-xs text-muted-foreground ml-2">AI-assistent</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isAuthenticated ? (
                  <Badge data-testid="badge-authenticated" className="gap-1.5 no-default-hover-elevate no-default-active-elevate">
                    <Shield className="h-3 w-3" />
                    {userContext
                      ? `${userContext.FirstName}${userContext.LastName ? ` ${userContext.LastName}` : ""}`
                      : "Innlogget"}
                    {userContext?.Pets && userContext.Pets.length > 0 && (
                      <span className="ml-1 opacity-70">
                        ({userContext.Pets.length} dyr)
                      </span>
                    )}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAuthDialog(true)}
                    className="gap-1.5"
                    data-testid="button-login"
                  >
                    <LogIn className="h-4 w-4" />
                    Logg inn
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleEndChat}
                  className="gap-1.5 text-muted-foreground"
                  data-testid="button-end-chat"
                >
                  <X className="h-4 w-4" />
                  Avslutt
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.length === 0 && !streamingContent && (
                  <div className="text-center py-8 space-y-4">
                    <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-3">
                      <Sparkles className="h-8 w-8 text-muted-foreground/60" />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        Hei! Jeg er DyreID sin support-assistent. Hva kan jeg hjelpe deg med?
                      </p>
                      {!isAuthenticated && (
                        <p className="text-xs text-muted-foreground/70 mt-2">
                          For personlig hjelp med dine dyr, logg inn med Min Side.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {QUICK_ACTIONS.slice(0, 4).map((action) => (
                        <Button
                          key={action.label}
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => sendDirectMessage(action.query)}
                          data-testid={`button-suggestion-${action.label.replace(/\s/g, "-")}`}
                        >
                          <action.icon className="h-3.5 w-3.5" />
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    userContext={userContext}
                    onSuggestionClick={(text) => sendDirectMessage(text)}
                    onLoginClick={() => setShowAuthDialog(true)}
                  />
                ))}

                {streamingContent && <StreamingMessage content={streamingContent} />}
                {isSending && !streamingContent && <TypingIndicator />}
              </div>
            </ScrollArea>

            <div className="p-3 border-t bg-background">
              <div className="flex gap-2 max-w-3xl mx-auto">
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={isAuthenticated ? "Skriv din melding..." : "Skriv din melding (logg inn for personlig hjelp)..."}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  disabled={isSending}
                  className="rounded-full"
                  data-testid="input-message"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!inputValue.trim() || isSending}
                  size="icon"
                  className="rounded-full shrink-0"
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                {authStep === "phone" ? (
                  <Shield className="h-5 w-5 text-primary" />
                ) : (
                  <KeyRound className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <DialogTitle>
                  {authStep === "phone" ? "Logg inn pa Min Side" : "Bekreft engangskode"}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {authStep === "phone"
                    ? "Skriv inn mobilnummer eller e-post for a identifisere deg."
                    : `En engangskode er sendt til ${authPhone}.`}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {authStep === "phone" ? (
              <>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={authPhone}
                    onChange={(e) => setAuthPhone(e.target.value)}
                    placeholder="Mobilnummer eller e-post"
                    onKeyDown={(e) => { if (e.key === "Enter") handleSendOtp(); }}
                    disabled={authLoading}
                    className="pl-10"
                    data-testid="input-auth-phone"
                  />
                </div>
                <Button
                  className="w-full gap-2"
                  onClick={handleSendOtp}
                  disabled={!authPhone.trim() || authLoading}
                  data-testid="button-send-otp"
                >
                  {authLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send engangskode
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  For demo: bruk 91000001-91000005
                </p>
              </>
            ) : (
              <>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="Skriv inn engangskode"
                    onKeyDown={(e) => { if (e.key === "Enter") handleVerifyOtp(); }}
                    disabled={authLoading}
                    className="pl-10"
                    data-testid="input-otp-code"
                  />
                </div>
                <Button
                  className="w-full gap-2"
                  onClick={handleVerifyOtp}
                  disabled={!otpCode.trim() || authLoading}
                  data-testid="button-verify-otp"
                >
                  {authLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Shield className="h-4 w-4" />
                  )}
                  Bekreft og logg inn
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => { setAuthStep("phone"); setOtpCode(""); setAuthError(""); }}
                  disabled={authLoading}
                  data-testid="button-back-to-phone"
                >
                  Tilbake
                </Button>
              </>
            )}
            {authError && (
              <div className="flex items-center gap-2 text-sm text-destructive" data-testid="text-auth-error">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
