"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { getSupabase } from "@/lib/supabase";

type Company = {
  id: string;
  nome: string;
  status: "ativa" | "suspensa";
  plano: string;
  vencimento: string | null;
  nao_suspender_automaticamente?: boolean;
  created_at: string;
  membros_ativos?: number;
  ultimo_backup?: { id: string; created_at: string; tipo: string } | null;
};

type Member = {
  user_id: string;
  email: string;
  papel: "usuario" | "admin_empresa";
  status: "ativo" | "bloqueado";
  ultimo_acesso?: string | null;
  created_at?: string;
};

type Backup = {
  id: string;
  empresa_id: string;
  arquivo: string;
  tipo: string;
  tamanho_bytes: number;
  resumo: Record<string, number>;
  created_at: string;
};

type AuditRecord = {
  id: string;
  user_id: string | null;
  user_email: string;
  empresa_id: string | null;
  empresa_nome: string;
  acao: string;
  detalhes: Record<string, unknown>;
  created_at: string;
};

const AUDIT_ACTION_MAP: Record<string, { label: string; badgeClass: string }> = {
  "empresa.suspensa": { label: "Empresa suspensa", badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" },
  "empresa.reativada": { label: "Empresa reativada", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  "empresa.criada": { label: "Empresa criada", badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  "empresa.atualizada": { label: "Empresa atualizada", badgeClass: "bg-slate-500/10 text-slate-300 border-slate-500/30" },
  "empresa.excluida": { label: "Empresa excluída", badgeClass: "bg-red-600/15 text-red-500 border-red-600/40" },
  "membro.convidado": { label: "Usuário convidado", badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  "membro.criado": { label: "Usuário criado (senha provisória)", badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" },
  "membro.vinculado": { label: "Usuário vinculado", badgeClass: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30" },
  "membro.reativado": { label: "Usuário reativado", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  "membro.bloqueado": { label: "Usuário bloqueado", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  "membro.desbloqueado": { label: "Usuário desbloqueado", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  "membro.papel_alterado": { label: "Papel alterado", badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/30" },
  "membro.senha_resetada": { label: "Senha resetada", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  "membro.removido": { label: "Usuário removido", badgeClass: "bg-red-500/10 text-red-500 border-red-500/30" },
  "backup.manual_criado": { label: "Backup manual", badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  "backup.automatico_criado": { label: "Backup automático", badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
  "backup.restaurado": { label: "Backup restaurado", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  "sistema.inicializado": { label: "Sistema ativado", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
};

function formatAuditAction(action: string) {
  return AUDIT_ACTION_MAP[action] || {
    label: action.replace(".", " · "),
    badgeClass: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  };
}

function formatAuditDetails(detalhes?: Record<string, unknown>): string {
  if (!detalhes || Object.keys(detalhes).length === 0) return "Nenhum detalhe adicional";
  const parts: string[] = [];
  if (detalhes.mensagem) parts.push(String(detalhes.mensagem));
  if (detalhes.email) parts.push(`E-mail: ${detalhes.email}`);
  if (detalhes.nome) parts.push(`Nome: ${detalhes.nome}`);
  if (detalhes.empresa_nome) parts.push(`Empresa: ${detalhes.empresa_nome}`);
  if (detalhes.novo_papel) parts.push(`Papel: ${detalhes.novo_papel === "admin_empresa" ? "Admin" : "Usuário"}`);
  if (detalhes.novo_status) parts.push(`Status: ${detalhes.novo_status}`);
  if (detalhes.campos && Array.isArray(detalhes.campos)) parts.push(`Campos: ${detalhes.campos.join(", ")}`);
  if (detalhes.metodo) parts.push(`Método: ${detalhes.metodo}`);
  if (detalhes.resumo && typeof detalhes.resumo === "object") {
    const summary = detalhes.resumo as Record<string, number>;
    const count = Object.values(summary).reduce((a, b) => a + Number(b), 0);
    parts.push(`Registros: ${count}`);
  }
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(detalhes);
}

type ToastMessage = {
  id: number;
  type: "success" | "error" | "warning";
  text: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

// Limites padrão de membros por plano
const PLAN_LIMITS: Record<string, number> = {
  gratuito: 2,
  grátis: 2,
  gratis: 2,
  básico: 3,
  basico: 3,
  padrão: 10,
  padrao: 10,
  profissional: 25,
  pro: 25,
  empresarial: 50,
};

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatLastAccess(dateString?: string | null): string {
  if (!dateString) return "Nunca acessou";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "Nunca acessou";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "Nunca acessou";
  }
}

function getDueDateBadge(vencimento?: string | null): { label: string; badgeClass: string } | null {
  if (!vencimento) return null;
  const parts = vencimento.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [ano, mes, dia] = parts;
  const due = new Date(ano, mes - 1, dia);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      label: "Vencida",
      badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    };
  }
  if (diffDays === 0) {
    return {
      label: "Vence hoje",
      badgeClass: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    };
  }
  if (diffDays <= 7) {
    return {
      label: `Vence em ${diffDays} dias`,
      badgeClass: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    };
  }
  return null;
}

function formatDueDateDisplay(vencimento?: string | null): string {
  if (!vencimento) return "Sem vencimento";
  try {
    const [ano, mes, dia] = vencimento.slice(0, 10).split("-").map(Number);
    if (!ano || !mes || !dia) return vencimento;
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(ano, mes - 1, dia)
    );
  } catch {
    return vencimento;
  }
}

function formatLastBackupDisplay(ultimoBackup?: { created_at: string; tipo: string } | null): {
  isOver24h: boolean;
  label: string;
} {
  if (!ultimoBackup?.created_at) {
    return { isOver24h: true, label: "Sem backup há mais de 24h" };
  }
  try {
    const d = new Date(ultimoBackup.created_at);
    if (isNaN(d.getTime())) return { isOver24h: true, label: "Sem backup há mais de 24h" };
    const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
    if (diffHours > 24) {
      return { isOver24h: true, label: "Sem backup há mais de 24h" };
    }
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return { isOver24h: false, label: `Último backup: ${formatted}` };
  } catch {
    return { isOver24h: true, label: "Sem backup há mais de 24h" };
  }
}

function mapSupabaseError(error: unknown, defaultMessage = "Algo deu errado. Tente de novo."): string {
  if (!navigator.onLine) {
    return "Sem conexão. Verifique sua internet e tente de novo.";
  }

  const rawMsg =
    typeof error === "string"
      ? error
      : error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";

  if (rawMsg.includes("Failed to fetch") || rawMsg.includes("NetworkError")) {
    return "Sem conexão. Verifique sua internet e tente de novo.";
  }

  // Se a mensagem já for uma mensagem amigável conhecida do sistema, preserve-a
  const knownMessages = [
    "Informe o nome da empresa.",
    "O nome precisa ter pelo menos 3 caracteres.",
    "Já existe uma empresa com esse nome.",
    "Escolha um plano.",
    "Informe um e-mail.",
    "Esse e-mail não parece válido.",
    "Esse e-mail já é membro desta empresa.",
    "Escolha um papel.",
    "A empresa precisa ter pelo menos um administrador.",
    "Você não pode remover o seu próprio acesso.",
    "Você não pode alterar o seu próprio papel.",
    "Não é possível excluir a empresa em uso.",
    "Você não tem permissão para acessar esta área.",
    "Sua sessão expirou. Entre de novo.",
  ];

  for (const known of knownMessages) {
    if (rawMsg.includes(known)) return known;
  }

  if (rawMsg.includes("permite até")) {
    return rawMsg;
  }

  if (rawMsg.includes("23505")) {
    return "Já existe um registro com esses dados.";
  }

  if (rawMsg.includes("42501") || rawMsg.includes("permission denied")) {
    return "Você não tem permissão para realizar esta operação.";
  }

  if (rawMsg.includes("57014") || rawMsg.includes("timeout")) {
    return "A operação demorou muito. Tente de novo.";
  }

  if (rawMsg && !rawMsg.includes("at ") && !rawMsg.includes("webpack-internal")) {
    return rawMsg;
  }

  console.error("Erro interno registrado:", error);
  return defaultMessage;
}

async function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!navigator.onLine) {
    throw new Error("Sem conexão. Verifique sua internet e tente de novo.");
  }

  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init?.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  return window.fetch(url, {
    ...init,
    headers,
  });
}

function getInitials(nameOrEmail: string): string {
  if (!nameOrEmail || nameOrEmail.includes("não encontrado")) return "U";
  const clean = nameOrEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function useModalTrap(isOpen: boolean, modalRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements.length) return;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, modalRef]);
}

interface SuperAdminModalProps {
  onClose: () => void;
  onCompanyChanged?: () => void;
}

export function SuperAdminModal({ onClose, onCompanyChanged }: SuperAdminModalProps) {
  // Navegação principal: Empresas | Backups | Auditoria
  const [activeTab, setActiveTab] = useState<"empresas" | "backups" | "auditoria">("empresas");

  // Auditoria
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFilterCompany, setAuditFilterCompany] = useState<string>("todas");
  const [auditFilterAction, setAuditFilterAction] = useState<string>("todas");
  const [auditFilterPeriod, setAuditFilterPeriod] = useState<string>("todos");
  const [auditPage, setAuditPage] = useState<number>(1);
  const [auditTotalPages, setAuditTotalPages] = useState<number>(1);
  const [auditTotalRecords, setAuditTotalRecords] = useState<number>(0);

  // Sessão e permissão
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");
  const [activeCompanyId, setActiveCompanyId] = useState<string>("");
  const [permissionChecked, setPermissionChecked] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Busca de empresas
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Estado das empresas
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [companiesLoadError, setCompaniesLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modais principais
  const [selectedCompanyModalOpen, setSelectedCompanyModalOpen] = useState(false);
  const [createCompanyModalOpen, setCreateCompanyModalOpen] = useState(false);
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);

  // Modais de confirmação específicos
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTypedName, setDeleteTypedName] = useState("");

  const [statusConfirmTarget, setStatusConfirmTarget] = useState<{ company: Company; nextStatus: "ativa" | "suspensa" } | null>(null);

  const [restoreConfirmBackup, setRestoreConfirmBackup] = useState<Backup | null>(null);
  const [restoreTypedName, setRestoreTypedName] = useState("");
  const [restoring, setRestoring] = useState(false);
  const restoreNameInputRef = useRef<HTMLInputElement>(null);

  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<{ userId: string; email: string } | null>(null);

  // Referências para foco e Tab Trap
  const companyModalRef = useRef<HTMLDivElement>(null);
  const createCompanyModalRef = useRef<HTMLDivElement>(null);
  const addMemberModalRef = useRef<HTMLDivElement>(null);

  const editNomeInputRef = useRef<HTMLInputElement>(null);
  const newNomeInputRef = useRef<HTMLInputElement>(null);
  const newMemberEmailRef = useRef<HTMLInputElement>(null);
  const deleteNameInputRef = useRef<HTMLInputElement>(null);

  useModalTrap(selectedCompanyModalOpen && !addMemberModalOpen && !discardConfirmOpen && !deleteConfirmOpen && !statusConfirmTarget && !removeMemberConfirm && !restoreConfirmBackup, companyModalRef);
  useModalTrap(createCompanyModalOpen, createCompanyModalRef);
  useModalTrap(addMemberModalOpen, addMemberModalRef);

  // Aba interna do modal da empresa: Dados | Membros
  const [companyTab, setCompanyTab] = useState<"dados" | "membros">("dados");

  // Formulário de edição da empresa
  const [formNome, setFormNome] = useState("");
  const [formPlano, setFormPlano] = useState("Padrão");
  const [formVencimento, setFormVencimento] = useState("");
  const [formStatus, setFormStatus] = useState<"ativa" | "suspensa">("ativa");
  const [formNaoSuspender, setFormNaoSuspender] = useState(false);
  const [editErrors, setEditErrors] = useState<{ nome?: string; plano?: string }>({});

  // Formulário de nova empresa
  const [newCompanyNome, setNewCompanyNome] = useState("");
  const [newCompanyPlano, setNewCompanyPlano] = useState("Padrão");
  const [newCompanyVencimento, setNewCompanyVencimento] = useState("");
  const [newCompanyNaoSuspender, setNewCompanyNaoSuspender] = useState(false);
  const [newCompanyErrors, setNewCompanyErrors] = useState<{ nome?: string; plano?: string }>({});

  // Menu de opções da empresa (⋯)
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const companyMenuRef = useRef<HTMLDivElement>(null);

  // Membros da empresa
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersLoadError, setMembersLoadError] = useState<string | null>(null);
  const membersCacheRef = useRef<Record<string, Member[]>>({});
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"usuario" | "admin_empresa">("usuario");
  const [inviteMethod, setInviteMethod] = useState<"convite" | "senha_provisoria">("convite");
  const [tempPasswordInput, setTempPasswordInput] = useState("");
  const [createdTempPasswordInfo, setCreatedTempPasswordInfo] = useState<{ email: string; password: string } | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState<{ email: string; link?: string } | null>(null);
  const [memberErrors, setMemberErrors] = useState<{ email?: string; papel?: string }>({});
  const [activeMemberMenuId, setActiveMemberMenuId] = useState<string | null>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);

  // Backups
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backupsLoadError, setBackupsLoadError] = useState<string | null>(null);
  const backupsCacheRef = useRef<Record<string, Backup[]>>({});
  const [backupCompanyId, setBackupCompanyId] = useState<string>("");
  const [generatingBackup, setGeneratingBackup] = useState(false);

  // Toast e Notificações
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((type: "success" | "error" | "warning", text: string, action?: { label: string; onClick: () => void }) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const id = Date.now();
    setToast({ id, type, text, action });
    toastTimerRef.current = setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 4500);
  }, []);

  const showSuccess = useCallback((text: string) => showToast("success", text), [showToast]);
  const showError = useCallback((text: string, onRetry?: () => void) => {
    showToast("error", text, onRetry ? { label: "Tentar de novo", onClick: onRetry } : undefined);
  }, [showToast]);
  const showWarning = useCallback((text: string) => showToast("warning", text), [showToast]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  );

  // Filtro de empresas pela busca
  const filteredCompanies = useMemo(() => {
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter(
      (c) => c.nome.toLowerCase().includes(q) || c.plano.toLowerCase().includes(q)
    );
  }, [companies, search]);

  // Detecta se há alterações pendentes no formulário de dados da empresa
  const isDirty = useMemo(() => {
    if (!selectedCompany) return false;
    const initialNome = selectedCompany.nome || "";
    const initialPlano = selectedCompany.plano || "Padrão";
    const initialVenc = selectedCompany.vencimento ? selectedCompany.vencimento.slice(0, 10) : "";
    const initialStatus = selectedCompany.status || "ativa";
    const initialNaoSuspender = Boolean(selectedCompany.nao_suspender_automaticamente);

    return (
      formNome !== initialNome ||
      formPlano !== initialPlano ||
      formVencimento !== initialVenc ||
      formStatus !== initialStatus ||
      formNaoSuspender !== initialNaoSuspender
    );
  }, [selectedCompany, formNome, formPlano, formVencimento, formStatus, formNaoSuspender]);

  // Métricas para os cards de Visão Geral (Etapa 6)
  const overviewMetrics = useMemo(() => {
    const ativas = companies.filter((c) => c.status === "ativa").length;
    const suspensas = companies.filter((c) => c.status === "suspensa").length;
    const totalUsuarios = companies.reduce((acc, c) => acc + (c.membros_ativos || 0), 0);
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const vencendo7Dias = companies.filter((c) => {
      if (c.status !== "ativa" || !c.vencimento) return false;
      const v = c.vencimento.slice(0, 10);
      return v <= in7Days;
    }).length;

    return { ativas, suspensas, totalUsuarios, vencendo7Dias };
  }, [companies]);

  // Alerta de data passada
  const isPastDueDate = useMemo(() => {
    if (!formVencimento) return false;
    const todayStr = new Date().toISOString().slice(0, 10);
    return formVencimento < todayStr;
  }, [formVencimento]);

  const isNewPastDueDate = useMemo(() => {
    if (!newCompanyVencimento) return false;
    const todayStr = new Date().toISOString().slice(0, 10);
    return newCompanyVencimento < todayStr;
  }, [newCompanyVencimento]);

  // 1. Checar sessão e permissão ao montar
  useEffect(() => {
    let isMounted = true;
    async function checkAuthAndPermission() {
      const supabase = getSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        showError("Sua sessão expirou. Entre de novo.");
        setTimeout(() => onClose(), 1200);
        return;
      }

      if (!isMounted) return;
      setCurrentUserId(session.user.id);
      setCurrentUserEmail(session.user.email || "");

      const activeStorage = localStorage.getItem(`minha-agenda:empresa-ativa:${session.user.id}`) || "";
      setActiveCompanyId(activeStorage);

      // Verificar sessão administrativa via API (/api/admin/session)
      try {
        const res = await adminFetch("/api/admin/session");
        if (res.ok) {
          const sessionData = await res.json();
          if (sessionData.is_admin) {
            setIsSuperAdmin(Boolean(sessionData.is_super_admin));
            setPermissionChecked(true);
            return;
          }
        }
      } catch (err) {
        console.warn("Falha ao checar sessão admin via API:", err);
      }

      // Fallback local: checar se é davi@avisnet.com.br
      if (session.user.email?.toLowerCase() === "davi@avisnet.com.br") {
        setIsSuperAdmin(true);
        setPermissionChecked(true);
        return;
      }

      // Fallback local: checar RPC / tabela super_admins ou membro admin_empresa
      try {
        const { data: isSuper } = await supabase.rpc("is_super_admin");
        if (isSuper) {
          setIsSuperAdmin(true);
          setPermissionChecked(true);
          return;
        }

        const { data: superRows } = await supabase
          .from("super_admins")
          .select("user_id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (superRows?.user_id) {
          setIsSuperAdmin(true);
          setPermissionChecked(true);
          return;
        }

        const { data: memberAdmins } = await supabase
          .from("membros")
          .select("empresa_id")
          .eq("user_id", session.user.id)
          .eq("papel", "admin_empresa")
          .eq("status", "ativo");

        if (memberAdmins && memberAdmins.length > 0) {
          setIsSuperAdmin(false);
          setPermissionChecked(true);
          return;
        }

        showError("Você não tem permissão para acessar esta área.");
        setTimeout(() => onClose(), 1500);
      } catch (err) {
        console.warn("Falha ao checar permissões locais:", err);
        showError("Você não tem permissão para acessar esta área.");
        setTimeout(() => onClose(), 1500);
      }

      setPermissionChecked(true);
    }

    void checkAuthAndPermission();
    return () => {
      isMounted = false;
    };
  }, [onClose, showError]);

  // Fechar menu de opções ao clicar fora
  useEffect(() => {
    if (!companyMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) {
        setCompanyMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [companyMenuOpen]);

  // Fechar menu de ações do membro ao clicar fora
  useEffect(() => {
    if (!activeMemberMenuId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (memberMenuRef.current && !memberMenuRef.current.contains(e.target as Node)) {
        setActiveMemberMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeMemberMenuId]);

  // Carregar lista de empresas
  const loadCompanies = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setCompaniesLoadError(null);
      const res = await adminFetch("/api/admin/companies", {
        cache: "no-store",
      });

      if (res.status === 401) {
        showError("Sua sessão expirou. Entre de novo.");
        setTimeout(() => onClose(), 1200);
        return;
      }

      if (res.status === 403) {
        showError("Você não tem permissão para acessar esta área.");
        setTimeout(() => onClose(), 1200);
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível carregar as empresas.");
      }

      const data = await res.json();
      const list: Company[] = data.empresas || [];
      setCompanies(list);
      if (!backupCompanyId && list.length > 0) {
        setBackupCompanyId(list[0].id);
      }
    } catch (err) {
      const msg = mapSupabaseError(err, "Não foi possível carregar as empresas.");
      setCompaniesLoadError(msg);
      showError(msg, () => void loadCompanies());
    } finally {
      if (!silent) setLoading(false);
    }
  }, [backupCompanyId, onClose, showError]);

  useEffect(() => {
    if (permissionChecked) {
      loadCompanies();
    }
  }, [permissionChecked, loadCompanies]);

  // Sincroniza formulário ao selecionar uma empresa
  useEffect(() => {
    if (selectedCompany) {
      setFormNome(selectedCompany.nome || "");
      setFormPlano(selectedCompany.plano || "Padrão");
      setFormVencimento(selectedCompany.vencimento ? selectedCompany.vencimento.slice(0, 10) : "");
      setFormStatus(selectedCompany.status || "ativa");
      setFormNaoSuspender(Boolean(selectedCompany.nao_suspender_automaticamente));
      setEditErrors({});
    }
  }, [selectedCompany]);

  // Carregar membros da empresa selecionada (com cache para transição instantânea entre abas)
  const loadMembers = useCallback(async (companyId: string, force = false) => {
    if (!companyId) return;

    const cached = membersCacheRef.current[companyId];
    if (cached && !force) {
      setMembers(cached);
    } else {
      setLoadingMembers(true);
    }

    try {
      setMembersLoadError(null);
      const res = await adminFetch(`/api/admin/companies/${companyId}/members`);

      if (res.status === 401) {
        showError("Sua sessão expirou. Entre de novo.");
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível carregar os membros.");
      }

      const data = await res.json();
      const list: Member[] = data.membros || [];
      membersCacheRef.current[companyId] = list;
      setMembers(list);
    } catch (err) {
      const msg = mapSupabaseError(err, "Não foi possível carregar os membros.");
      setMembersLoadError(msg);
      showError(msg, () => void loadMembers(companyId, true));
    } finally {
      setLoadingMembers(false);
    }
  }, [showError]);

  useEffect(() => {
    if (selectedCompanyId && selectedCompanyModalOpen) {
      loadMembers(selectedCompanyId);
    }
  }, [selectedCompanyId, selectedCompanyModalOpen, loadMembers]);

  // Carregar backups (com cache para transição instantânea)
  const loadBackups = useCallback(async (companyId: string, force = false) => {
    if (!companyId) return;

    const cached = backupsCacheRef.current[companyId];
    if (cached && !force) {
      setBackups(cached);
    } else {
      setLoadingBackups(true);
    }

    try {
      setBackupsLoadError(null);
      const res = await adminFetch(`/api/admin/companies/${companyId}/backups`);

      if (res.status === 401) {
        showError("Sua sessão expirou. Entre de novo.");
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível carregar os backups.");
      }

      const data = await res.json();
      const list: Backup[] = data.backups || [];
      backupsCacheRef.current[companyId] = list;
      setBackups(list);
    } catch (err) {
      const msg = mapSupabaseError(err, "Não foi possível carregar os backups.");
      setBackupsLoadError(msg);
      showError(msg, () => void loadBackups(companyId, true));
    } finally {
      setLoadingBackups(false);
    }
  }, [showError]);

  useEffect(() => {
    const target = backupCompanyId || companies[0]?.id;
    if (target && activeTab === "backups") {
      setBackupCompanyId(target);
      loadBackups(target);
    }
  }, [activeTab, backupCompanyId, companies, loadBackups]);

  // Carregar registros de auditoria
  const loadAudit = useCallback(async (page = 1) => {
    try {
      setLoadingAudit(true);
      setAuditError(null);
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "15",
        empresa_id: auditFilterCompany,
        acao: auditFilterAction,
        periodo: auditFilterPeriod,
      });
      const res = await adminFetch(`/api/admin/audit?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Não foi possível carregar os registros de auditoria.");
      }
      const data = await res.json();
      setAuditRecords(data.registros || []);
      setAuditPage(data.page || 1);
      setAuditTotalPages(data.totalPages || 1);
      setAuditTotalRecords(data.total || 0);
    } catch (err) {
      const msg = mapSupabaseError(err, "Falha ao carregar auditoria.");
      setAuditError(msg);
      showError(msg);
    } finally {
      setLoadingAudit(false);
    }
  }, [auditFilterCompany, auditFilterAction, auditFilterPeriod, showError]);

  useEffect(() => {
    if (activeTab === "auditoria") {
      void loadAudit(1);
    }
  }, [activeTab, loadAudit]);

  // Abrir modal de detalhes da empresa
  const handleOpenCompanyModal = (companyId: string) => {
    setSelectedCompanyId(companyId);
    setCompanyTab("dados");
    setEditErrors({});
    if (membersCacheRef.current[companyId]) {
      setMembers(membersCacheRef.current[companyId]);
    } else {
      setMembers([]);
    }
    setSelectedCompanyModalOpen(true);
    setCompanyMenuOpen(false);
  };

  // Solicitar fechamento do modal com verificação de alterações
  const requestCloseCompanyModal = useCallback(() => {
    if (isDirty) {
      setPendingDiscardAction(() => () => {
        setSelectedCompanyModalOpen(false);
        setCompanyMenuOpen(false);
      });
      setDiscardConfirmOpen(true);
      return;
    }
    setSelectedCompanyModalOpen(false);
    setCompanyMenuOpen(false);
  }, [isDirty]);

  // Iniciar cadastro de nova empresa em modal
  const handleStartCreateCompany = () => {
    setNewCompanyNome("");
    setNewCompanyPlano("Padrão");
    setNewCompanyVencimento("");
    setNewCompanyNaoSuspender(false);
    setNewCompanyErrors({});
    setCreateCompanyModalOpen(true);
  };

  // Fechar o painel administrativo inteiro
  const handleClose = useCallback(() => {
    if (selectedCompanyModalOpen && isDirty) {
      setPendingDiscardAction(() => () => onClose());
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  }, [selectedCompanyModalOpen, isDirty, onClose]);

  // Salvar alterações da empresa com validações
  const handleSaveCompany = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedCompanyId || !isDirty || busy) return;

    const trimmedNome = formNome.trim();
    const trimmedPlano = formPlano.trim();
    const errors: { nome?: string; plano?: string } = {};

    if (!trimmedNome) {
      errors.nome = "Informe o nome da empresa.";
    } else if (trimmedNome.length < 3) {
      errors.nome = "O nome precisa ter pelo menos 3 caracteres.";
    } else {
      const norm = normalizeText(trimmedNome);
      const isDuplicate = companies.some(
        (c) => c.id !== selectedCompanyId && normalizeText(c.nome) === norm
      );
      if (isDuplicate) {
        errors.nome = "Já existe uma empresa com esse nome.";
      }
    }

    if (!trimmedPlano) {
      errors.plano = "Escolha um plano.";
    }

    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      if (errors.nome) editNomeInputRef.current?.focus();
      return;
    }

    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/companies/${selectedCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: trimmedNome,
          plano: trimmedPlano,
          vencimento: formVencimento || null,
          status: formStatus,
          nao_suspender_automaticamente: formNaoSuspender,
        }),
      });

      if (res.status === 401) {
        showError("Sua sessão expirou. Entre de novo.");
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível salvar a empresa.");
      }

      const data = await res.json().catch(() => ({}));
      const updatedCompany = data.empresa;

      // 1. Atualiza estado local imediatamente (0ms de espera)
      if (updatedCompany) {
        setCompanies((prev) =>
          prev.map((c) =>
            c.id === selectedCompanyId
              ? {
                  ...c,
                  nome: updatedCompany.nome,
                  plano: updatedCompany.plano,
                  vencimento: updatedCompany.vencimento,
                  status: updatedCompany.status,
                  nao_suspender_automaticamente: Boolean(updatedCompany.nao_suspender_automaticamente),
                }
              : c
          )
        );
      }

      showSuccess("Empresa salva");
      setBusy(false);

      // 2. Sincronização em segundo plano sem bloquear o formulário
      void loadCompanies(true);
      onCompanyChanged?.();
      return;
    } catch (err) {
      showError(mapSupabaseError(err, "Não foi possível salvar a empresa. Tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  // Criar nova empresa no modal com validações
  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const trimmedNome = newCompanyNome.trim();
    const trimmedPlano = newCompanyPlano.trim();
    const errors: { nome?: string; plano?: string } = {};

    if (!trimmedNome) {
      errors.nome = "Informe o nome da empresa.";
    } else if (trimmedNome.length < 3) {
      errors.nome = "O nome precisa ter pelo menos 3 caracteres.";
    } else {
      const norm = normalizeText(trimmedNome);
      const isDuplicate = companies.some((c) => normalizeText(c.nome) === norm);
      if (isDuplicate) {
        errors.nome = "Já existe uma empresa com esse nome.";
      }
    }

    if (!trimmedPlano) {
      errors.plano = "Escolha um plano.";
    }

    if (Object.keys(errors).length > 0) {
      setNewCompanyErrors(errors);
      if (errors.nome) newNomeInputRef.current?.focus();
      return;
    }

    try {
      setBusy(true);
      const res = await adminFetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: trimmedNome,
          plano: trimmedPlano,
          vencimento: newCompanyVencimento || null,
          nao_suspender_automaticamente: newCompanyNaoSuspender,
        }),
      });

      if (res.status === 401) {
        showError("Sua sessão expirou. Entre de novo.");
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível criar a empresa.");
      }

      setCreateCompanyModalOpen(false);
      setNewCompanyNome("");
      setNewCompanyErrors({});
      await loadCompanies();
      showSuccess("Empresa cadastrada");
      onCompanyChanged?.();
    } catch (err) {
      showError(mapSupabaseError(err, "Não foi possível criar a empresa. Tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  // Copiar ID da empresa
  const handleCopyId = () => {
    if (!selectedCompany) return;
    navigator.clipboard.writeText(selectedCompany.id);
    setCompanyMenuOpen(false);
    showSuccess("ID copiado");
  };

  // Alternar status da empresa
  const handleRequestStatusChange = (company: Company, nextStatus: "ativa" | "suspensa") => {
    setCompanyMenuOpen(false);
    setStatusConfirmTarget({ company, nextStatus });
  };

  const handleToggleStatus = () => {
    if (!selectedCompany) return;
    setCompanyMenuOpen(false);
    handleRequestStatusChange(selectedCompany, selectedCompany.status === "ativa" ? "suspensa" : "ativa");
  };

  const executeStatusChange = async (targetCompany: Company, nextStatus: "ativa" | "suspensa") => {
    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/companies/${targetCompany.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível atualizar o status.");
      }

      if (selectedCompanyId === targetCompany.id) {
        setFormStatus(nextStatus);
      }
      setCompanies((prev) =>
        prev.map((c) => (c.id === targetCompany.id ? { ...c, status: nextStatus } : c))
      );
      showSuccess(nextStatus === "ativa" ? "Empresa reativada" : "Empresa suspensa");
      setBusy(false);
      setStatusConfirmTarget(null);
      void loadCompanies(true);
      onCompanyChanged?.();
      return;
    } catch (err) {
      showError(mapSupabaseError(err, "Falha ao alterar status. Tente de novo."));
    } finally {
      setBusy(false);
      setStatusConfirmTarget(null);
    }
  };

  // Preparar exclusão de empresa
  const handleStartDeleteCompany = () => {
    if (!selectedCompany) return;
    setCompanyMenuOpen(false);

    // 1. Bloquear se for a única empresa ativa do sistema
    const activeCompanies = companies.filter((c) => c.status === "ativa");
    if (activeCompanies.length <= 1 && selectedCompany.status === "ativa") {
      showError("Não é possível excluir a empresa em uso.");
      return;
    }

    // 2. Bloquear se for a empresa ativa em uso na sessão do usuário
    const currentActive =
      (currentUserId && localStorage.getItem(`minha-agenda:empresa-ativa:${currentUserId}`)) ||
      activeCompanyId ||
      "";
    if (currentActive && selectedCompany.id === currentActive) {
      showError("Não é possível excluir a empresa em uso.");
      return;
    }

    setDeleteTypedName("");
    setDeleteConfirmOpen(true);
    setTimeout(() => deleteNameInputRef.current?.focus(), 50);
  };

  // Executar exclusão após digitar nome
  const executeDeleteCompany = async () => {
    if (!selectedCompany || deleteTypedName.trim() !== selectedCompany.nome.trim() || busy) return;

    try {
      setBusy(true);
      const currentActive =
        (currentUserId && localStorage.getItem(`minha-agenda:empresa-ativa:${currentUserId}`)) ||
        activeCompanyId ||
        "";
      const res = await adminFetch(`/api/admin/companies/${selectedCompany.id}`, {
        method: "DELETE",
        headers: {
          "x-active-company-id": currentActive,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível excluir a empresa.");
      }

      const targetId = selectedCompany.id;

      setDeleteConfirmOpen(false);
      setSelectedCompanyModalOpen(false);
      setSelectedCompanyId("");

      // Remoção otimista imediata na lista visual
      setCompanies((prev) => prev.filter((c) => c.id !== targetId));

      // Limpar cache de empresas no localStorage do usuário
      if (currentUserId) {
        try {
          const cachedRaw = localStorage.getItem(`minha-agenda:empresas:${currentUserId}`);
          if (cachedRaw) {
            const cachedList = JSON.parse(cachedRaw) as { id: string }[];
            const updatedList = cachedList.filter((c) => c.id !== targetId);
            localStorage.setItem(`minha-agenda:empresas:${currentUserId}`, JSON.stringify(updatedList));
          }
        } catch {
          // ignore
        }
      }

      showSuccess("Empresa excluída");
      await loadCompanies();
      onCompanyChanged?.();
    } catch (err) {
      showError(mapSupabaseError(err, "Falha ao excluir empresa. Tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  // Abrir modal de adicionar membro com checagem de limite por plano
  const handleOpenAddMember = () => {
    if (!selectedCompany) return;

    const planKey = (selectedCompany.plano || "padrão").toLowerCase().trim();
    const limit = PLAN_LIMITS[planKey] || 10;
    const activeMembersCount = members.filter((m) => m.status === "ativo").length;

    if (activeMembersCount >= limit) {
      showWarning(`Esse plano permite até ${limit} membros.`);
      return;
    }

    setNewMemberEmail("");
    setNewMemberRole("usuario");
    setInviteMethod("convite");
    setTempPasswordInput("");
    setCreatedTempPasswordInfo(null);
    setMemberErrors({});
    setAddMemberModalOpen(true);
    setTimeout(() => newMemberEmailRef.current?.focus(), 50);
  };

  // Adicionar ou convidar membro pelo modal
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyId || busy) return;

    const trimmedEmail = newMemberEmail.trim().toLowerCase();
    const errors: { email?: string; papel?: string } = {};

    if (!trimmedEmail) {
      errors.email = "Informe um e-mail.";
    } else if (!isValidEmail(trimmedEmail)) {
      errors.email = "Esse e-mail não parece válido.";
    } else if (members.some((m) => m.email.toLowerCase() === trimmedEmail && m.status === "ativo")) {
      errors.email = "Esse e-mail já é membro desta empresa.";
    }

    if (!newMemberRole) {
      errors.papel = "Escolha um papel.";
    }

    if (Object.keys(errors).length > 0) {
      setMemberErrors(errors);
      if (errors.email) newMemberEmailRef.current?.focus();
      return;
    }

    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/companies/${selectedCompanyId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          papel: newMemberRole,
          metodo: inviteMethod,
          senha_provisoria: inviteMethod === "senha_provisoria" ? tempPasswordInput.trim() : undefined,
        }),
      });

      const resData = await res.json().catch(() => ({}));

      if (res.status === 401) {
        showError("Sua sessão expirou. Entre de novo.");
        return;
      }

      if (!res.ok) {
        throw new Error(resData.error || "Não foi possível vincular ou convidar o usuário.");
      }

      if (resData.senha_provisoria) {
        setCreatedTempPasswordInfo({
          email: trimmedEmail,
          password: resData.senha_provisoria,
        });
        showSuccess("Usuário cadastrado com sucesso com senha provisória");
      } else {
        setAddMemberModalOpen(false);
        showSuccess(resData.message || "Usuário convidado com sucesso");
      }

      setNewMemberEmail("");
      setTempPasswordInput("");
      setMemberErrors({});
      void loadMembers(selectedCompanyId, true);
      void loadCompanies(true);
    } catch (err) {
      showError(mapSupabaseError(err, "Erro ao convidar usuário. Tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  // Alterar papel do membro
  const handleChangeMemberRole = async (m: Member, newRole: "usuario" | "admin_empresa") => {
    if (!selectedCompanyId || busy) return;
    if (m.user_id === currentUserId && newRole === "usuario") {
      showError("Você não pode alterar o seu próprio papel.");
      return;
    }
    if (m.papel === "admin_empresa" && newRole === "usuario") {
      const activeAdmins = members.filter((mem) => mem.papel === "admin_empresa" && mem.status === "ativo");
      if (activeAdmins.length <= 1) {
        showError("A empresa precisa ter pelo menos um administrador ativo.");
        return;
      }
    }

    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/companies/${selectedCompanyId}/members/${m.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papel: newRole }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível alterar o papel.");
      }
      setMembers((prev) => {
        const next = prev.map((mem) => (mem.user_id === m.user_id ? { ...mem, papel: newRole } : mem));
        if (selectedCompanyId) membersCacheRef.current[selectedCompanyId] = next;
        return next;
      });
      showSuccess(`Papel alterado para ${newRole === "admin_empresa" ? "Administrador" : "Usuário"}`);
      setBusy(false);
      void loadMembers(selectedCompanyId, true);
      return;
    } catch (err) {
      showError(mapSupabaseError(err, "Falha ao alterar papel."));
    } finally {
      setBusy(false);
    }
  };

  // Bloquear ou desbloquear membro
  const handleToggleMemberStatus = async (m: Member) => {
    if (!selectedCompanyId || busy) return;
    const nextStatus: "ativo" | "bloqueado" = m.status === "ativo" ? "bloqueado" : "ativo";
    if (m.user_id === currentUserId && nextStatus === "bloqueado") {
      showError("Você não pode bloquear o seu próprio acesso.");
      return;
    }
    if (m.papel === "admin_empresa" && nextStatus === "bloqueado") {
      const activeAdmins = members.filter((mem) => mem.papel === "admin_empresa" && mem.status === "ativo");
      if (activeAdmins.length <= 1) {
        showError("A empresa precisa ter pelo menos um administrador ativo.");
        return;
      }
    }

    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/companies/${selectedCompanyId}/members/${m.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível alterar o status do usuário.");
      }
      setMembers((prev) => {
        const next = prev.map((mem) => (mem.user_id === m.user_id ? { ...mem, status: nextStatus } : mem));
        if (selectedCompanyId) membersCacheRef.current[selectedCompanyId] = next;
        return next;
      });
      showSuccess(nextStatus === "ativo" ? "Usuário desbloqueado com sucesso" : "Usuário bloqueado com sucesso");
      setBusy(false);
      void loadMembers(selectedCompanyId, true);
      void loadCompanies(true);
      return;
    } catch (err) {
      showError(mapSupabaseError(err, "Falha ao alterar status do usuário."));
    } finally {
      setBusy(false);
    }
  };

  // Resetar senha do membro
  const handleResetMemberPassword = async (m: Member) => {
    if (!selectedCompanyId || busy) return;
    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/companies/${selectedCompanyId}/members/${m.user_id}/reset-password`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível resetar a senha.");
      }
      if (data.action_link) {
        setResetPasswordResult({ email: m.email, link: data.action_link });
      } else {
        showSuccess("E-mail de redefinição de senha enviado com sucesso!");
      }
    } catch (err) {
      showError(mapSupabaseError(err, "Falha ao resetar senha."));
    } finally {
      setBusy(false);
    }
  };

  // Preparar remoção de membro
  const handleStartRemoveMember = (m: Member) => {
    // 1. Bloquear remover o próprio acesso
    if (m.user_id === currentUserId || m.email.toLowerCase() === currentUserEmail.toLowerCase()) {
      showError("Você não pode remover o seu próprio acesso.");
      return;
    }

    // 2. Bloquear remover o último administrador da empresa
    const activeAdmins = members.filter((mem) => mem.papel === "admin_empresa" && mem.status === "ativo");
    if (m.papel === "admin_empresa" && activeAdmins.length <= 1) {
      showError("A empresa precisa ter pelo menos um administrador.");
      return;
    }

    setRemoveMemberConfirm({ userId: m.user_id, email: m.email });
  };

  // Executar remoção de membro confirmada
  const executeRemoveMember = async () => {
    if (!removeMemberConfirm || !selectedCompanyId || busy) return;
    const { userId } = removeMemberConfirm;

    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/companies/${selectedCompanyId}/members/${userId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível remover o membro.");
      }

      setMembers((prev) => {
        const next = prev.filter((mem) => mem.user_id !== userId);
        if (selectedCompanyId) membersCacheRef.current[selectedCompanyId] = next;
        return next;
      });
      setRemoveMemberConfirm(null);
      showSuccess("Membro removido");
      setBusy(false);
      void loadMembers(selectedCompanyId, true);
      void loadCompanies(true);
      return;
    } catch (err) {
      showError(mapSupabaseError(err, "Erro ao remover membro. Tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  // Gerar backup
  const handleGenerateBackup = async () => {
    const compId = backupCompanyId || companies[0]?.id;
    if (!compId || generatingBackup) return;

    try {
      setGeneratingBackup(true);
      const res = await adminFetch(`/api/admin/companies/${compId}/backups`, {
        method: "POST",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Não foi possível gerar o backup.");
      }

      await loadBackups(compId);
      showSuccess("Backup concluído");

      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Backup concluído", {
          body: "O backup da empresa foi concluído e está pronto para download.",
        });
      }
    } catch (err) {
      showError(mapSupabaseError(err, "Não foi possível gerar o backup. Tente de novo."), () => void handleGenerateBackup());
    } finally {
      setGeneratingBackup(false);
    }
  };

  // Baixar backup
  const handleDownloadBackup = async (backupId: string, filename: string) => {
    if (generatingBackup) return;
    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/backups/${backupId}/download`);
      if (!res.ok) throw new Error("Não foi possível baixar o arquivo. Verifique o espaço em disco e tente de novo.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showError(mapSupabaseError(err, "Não foi possível baixar o arquivo. Verifique o espaço em disco e tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  // Iniciar restauração com confirmação estrita
  const handleStartRestore = (b: Backup) => {
    setRestoreConfirmBackup(b);
    setRestoreTypedName("");
    setTimeout(() => restoreNameInputRef.current?.focus(), 50);
  };

  // Executar restauração confirmada
  const handleExecuteRestore = async () => {
    if (!restoreConfirmBackup || !backupCompanyId || restoring) return;
    const targetComp = companies.find((c) => c.id === backupCompanyId);
    if (!targetComp || restoreTypedName.trim() !== targetComp.nome.trim()) return;

    try {
      setRestoring(true);
      const res = await adminFetch(`/api/admin/backups/${restoreConfirmBackup.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa_id: backupCompanyId,
          confirm_nome: restoreTypedName.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Não foi possível restaurar o backup.");
      }

      showSuccess(`Backup restaurado com sucesso para "${targetComp.nome}"!`);
      setRestoreConfirmBackup(null);
      setRestoreTypedName("");
      await loadBackups(backupCompanyId);
      onCompanyChanged?.();
    } catch (err) {
      showError(mapSupabaseError(err, "Falha ao restaurar backup."));
    } finally {
      setRestoring(false);
    }
  };

  // Atalhos de teclado: Esc fecha o modal do topo, Ctrl+F busca, N nova empresa, Ctrl+S salva
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";

      if (e.key === "Escape") {
        e.preventDefault();
        if (discardConfirmOpen) {
          setDiscardConfirmOpen(false);
        } else if (deleteConfirmOpen) {
          setDeleteConfirmOpen(false);
        } else if (statusConfirmTarget) {
          setStatusConfirmTarget(null);
        } else if (restoreConfirmBackup) {
          setRestoreConfirmBackup(null);
          setRestoreTypedName("");
        } else if (removeMemberConfirm) {
          setRemoveMemberConfirm(null);
        } else if (addMemberModalOpen) {
          setAddMemberModalOpen(false);
        } else if (companyMenuOpen) {
          setCompanyMenuOpen(false);
        } else if (createCompanyModalOpen) {
          setCreateCompanyModalOpen(false);
        } else if (selectedCompanyModalOpen) {
          requestCloseCompanyModal();
        } else {
          handleClose();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key.toLowerCase() === "n" && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleStartCreateCompany();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (selectedCompanyModalOpen && companyTab === "dados" && isDirty) {
          void handleSaveCompany();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleClose,
    requestCloseCompanyModal,
    discardConfirmOpen,
    deleteConfirmOpen,
    statusConfirmTarget,
    restoreConfirmBackup,
    removeMemberConfirm,
    addMemberModalOpen,
    companyMenuOpen,
    createCompanyModalOpen,
    selectedCompanyModalOpen,
    companyTab,
    isDirty,
  ]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col h-screen w-screen overflow-hidden bg-[var(--page)] text-[var(--text)] select-none"
      style={{ colorScheme: "dark" }}
    >
      {/* ─── Cabeçalho no Mesmo Padrão da Agenda ────────────────────────── */}
      <header className="surface sticky top-0 z-30 border-b line shrink-0">
        <div className="agenda-header-content mx-auto max-w-[1400px] px-4 py-3 sm:px-6">
          {/* Linha 1: Voltar + Título com subtítulo + Busca + Ações */}
          <div className="flex items-center justify-between gap-4 min-w-0">
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={handleClose}
                className="agenda-icon-button"
                title="Voltar para a agenda (Esc)"
                aria-label="Voltar para a agenda"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex flex-col">
                <h1 className="text-xl font-bold leading-tight whitespace-nowrap">Painel administrativo</h1>
                <p className="agenda-heading-date text-xs text-muted whitespace-nowrap">
                  Gerenciamento de empresas, membros e backups
                </p>
              </div>
            </div>

            {/* Campo de Busca "Buscar empresas..." com badge Ctrl F */}
            <div className="agenda-search-tools max-w-md w-full">
              <div className="app-header-search relative w-full">
                <input
                  ref={searchInputRef}
                  className="field py-2 pl-9 pr-16 w-full"
                  placeholder="Buscar empresas..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <svg
                  className="agenda-search-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                {!search && (
                  <kbd className="agenda-search-kbd" aria-hidden="true">
                    <span>Ctrl</span>
                    <span>F</span>
                  </kbd>
                )}
              </div>
            </div>

            {/* Ações à direita da Linha 1 */}
            <div className="app-header-actions shrink-0">
              {activeTab === "empresas" && isSuperAdmin && (
                <button
                  type="button"
                  title="Nova empresa (N)"
                  className="btn btn-primary agenda-action agenda-new-action"
                  onClick={handleStartCreateCompany}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Nova empresa</span>
                  <kbd className="agenda-kbd agenda-action-kbd">N</kbd>
                </button>
              )}
            </div>
          </div>

          {/* Linha 2: Grupo em pílula escura "Empresas | Backups" */}
          <nav className="agenda-navigation" aria-label="Navegação do painel">
            <div className="agenda-views" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "empresas"}
                className={`agenda-tab agenda-view-tab ${
                  activeTab === "empresas"
                    ? "!border-[color-mix(in_srgb,var(--border)_85%,transparent)] !bg-[var(--surface)] !text-[var(--primary)] !shadow-[0_1px_3px_rgba(15,23,42,0.1)] font-bold"
                    : ""
                }`}
                onClick={() => setActiveTab("empresas")}
              >
                Empresas ({companies.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "backups"}
                className={`agenda-tab agenda-view-tab ${
                  activeTab === "backups"
                    ? "!border-[color-mix(in_srgb,var(--border)_85%,transparent)] !bg-[var(--surface)] !text-[var(--primary)] !shadow-[0_1px_3px_rgba(15,23,42,0.1)] font-bold"
                    : ""
                }`}
                onClick={() => setActiveTab("backups")}
              >
                Backups
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "auditoria"}
                className={`agenda-tab agenda-view-tab ${
                  activeTab === "auditoria"
                    ? "!border-[color-mix(in_srgb,var(--border)_85%,transparent)] !bg-[var(--surface)] !text-[var(--primary)] !shadow-[0_1px_3px_rgba(15,23,42,0.1)] font-bold"
                    : ""
                }`}
                onClick={() => setActiveTab("auditoria")}
              >
                Auditoria
              </button>
            </div>
          </nav>
        </div>
      </header>

      {/* ─── Corpo Principal ────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
          {activeTab === "empresas" ? (
            /* ─── ABA EMPRESAS: Visão Geral + Lista ocupando a largura total ───────── */
            <section className="card p-4 sm:p-6 w-full flex flex-col space-y-6">
              {/* Visão Geral (Etapa 6): Cards de métricas */}
              <div>
                <p className="muted text-xs font-semibold uppercase tracking-wider mb-3">Visão Geral</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <div className="rounded-xl border line p-3 sm:p-4 surface flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="muted text-[11px] font-semibold uppercase tracking-wider">Ativas</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    </div>
                    <p className="text-2xl sm:text-3xl font-bold mt-2 text-emerald-600 dark:text-emerald-400">
                      {overviewMetrics.ativas}
                    </p>
                    <p className="muted text-[11px] mt-1">Empresas em operação</p>
                  </div>

                  <div className="rounded-xl border line p-3 sm:p-4 surface flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="muted text-[11px] font-semibold uppercase tracking-wider">Suspensas</span>
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                    </div>
                    <p className="text-2xl sm:text-3xl font-bold mt-2 text-red-600 dark:text-red-400">
                      {overviewMetrics.suspensas}
                    </p>
                    <p className="muted text-[11px] mt-1">Acesso bloqueado</p>
                  </div>

                  <div className="rounded-xl border line p-3 sm:p-4 surface flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="muted text-[11px] font-semibold uppercase tracking-wider">Usuários</span>
                      <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
                    </div>
                    <p className="text-2xl sm:text-3xl font-bold mt-2 text-[var(--primary)]">
                      {overviewMetrics.totalUsuarios}
                    </p>
                    <p className="muted text-[11px] mt-1">Membros ativos</p>
                  </div>

                  <div className="rounded-xl border line p-3 sm:p-4 surface flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="muted text-[11px] font-semibold uppercase tracking-wider">Vencendo</span>
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                    </div>
                    <p className="text-2xl sm:text-3xl font-bold mt-2 text-amber-500">
                      {overviewMetrics.vencendo7Dias}
                    </p>
                    <p className="muted text-[11px] mt-1">Em até 7 dias</p>
                  </div>
                </div>
              </div>

              {/* Cabeçalho da listagem de empresas */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t line pt-5">
                <div>
                  <h2 className="text-lg font-bold">Empresas cadastradas</h2>
                  <p className="muted text-xs mt-0.5">
                    {filteredCompanies.length} {filteredCompanies.length === 1 ? "empresa cadastrada" : "empresas cadastradas"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadCompanies()}
                    disabled={loading}
                    className="btn btn-ghost border line text-xs font-semibold px-3 py-1.5 h-auto flex items-center gap-1.5 hover:border-[var(--primary)]"
                    title="Atualizar lista de empresas"
                  >
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 ${loading ? "animate-spin" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    <span>Atualizar</span>
                  </button>

                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={handleStartCreateCompany}
                      className="btn btn-primary agenda-action agenda-new-action text-xs font-semibold px-3 py-1.5 h-auto"
                    >
                      + Nova empresa
                    </button>
                  )}
                </div>
              </div>

              {companiesLoadError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-8 text-center space-y-3">
                  <p className="text-sm font-semibold text-red-400">{companiesLoadError}</p>
                  <button
                    type="button"
                    onClick={() => void loadCompanies()}
                    className="btn btn-ghost border line text-xs font-medium"
                  >
                    Tentar de novo
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {loading && companies.length === 0 ? (
                    <div className="p-12 text-center text-sm text-muted">Carregando empresas...</div>
                  ) : companies.length === 0 ? (
                    <div className="rounded-xl border border-dashed line p-12 text-center space-y-3">
                      <p className="font-semibold text-sm">Nenhuma empresa ainda.</p>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={handleStartCreateCompany}
                          className="btn btn-primary agenda-action agenda-new-action mx-auto"
                        >
                          Nova empresa
                        </button>
                      )}
                    </div>
                  ) : filteredCompanies.length === 0 ? (
                    <div className="rounded-xl border border-dashed line p-12 text-center">
                      <p className="font-semibold text-sm">Nenhuma empresa encontrada para &apos;{search}&apos;.</p>
                      <p className="muted mt-1 text-xs">Tente outro termo na busca.</p>
                    </div>
                  ) : (
                    filteredCompanies.map((c) => {
                      const dueBadge = getDueDateBadge(c.vencimento);
                      const backupInfo = formatLastBackupDisplay(c.ultimo_backup);

                      return (
                        <div
                          key={c.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpenCompanyModal(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") handleOpenCompanyModal(c.id);
                          }}
                          title={c.nome}
                          className="rounded-xl border line p-4 surface hover:shadow-md hover:border-[var(--primary)] transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold text-base truncate group-hover:text-[var(--primary)] transition-colors">
                                {c.nome}
                              </p>
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide border ${
                                  c.status === "ativa"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                    : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                                }`}
                              >
                                {c.status === "ativa" ? "Ativa" : "Suspensa"}
                              </span>

                              {dueBadge && (
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${dueBadge.badgeClass}`}>
                                  {dueBadge.label}
                                </span>
                              )}

                              {c.nao_suspender_automaticamente && (
                                <span
                                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold border bg-slate-500/10 text-slate-300 border-slate-500/30"
                                  title="Não suspenderá automaticamente após o vencimento"
                                >
                                  Exceção: Não suspende
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
                              <span className="muted">
                                Plano <strong className="text-foreground">{c.plano}</strong>
                              </span>
                              <span className="muted">·</span>
                              <span className="muted">
                                Vencimento: <span className="font-medium">{formatDueDateDisplay(c.vencimento)}</span>
                              </span>
                              <span className="muted">·</span>
                              <span className="muted">
                                {c.membros_ativos ?? 0} {c.membros_ativos === 1 ? "usuário" : "usuários"}
                              </span>
                            </div>
                          </div>

                          {/* Coluna de Último Backup (Etapa 6) + Ações */}
                          <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 line">
                            <div>
                              {backupInfo.isOver24h ? (
                                <span
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30"
                                  title="Atenção: esta empresa não possui backup recente realizado nas últimas 24 horas"
                                >
                                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                    />
                                  </svg>
                                  Sem backup há mais de 24h
                                </span>
                              ) : (
                                <span className="muted text-xs block text-right font-medium">
                                  {backupInfo.label}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRequestStatusChange(c, c.status === "ativa" ? "suspensa" : "ativa");
                                }}
                                className={`btn btn-ghost border line text-xs font-semibold px-2.5 py-1 h-auto transition-colors ${
                                  c.status === "ativa"
                                    ? "hover:text-amber-500 hover:border-amber-500/40"
                                    : "hover:text-emerald-500 hover:border-emerald-500/40"
                                }`}
                                title={c.status === "ativa" ? "Suspender empresa" : "Reativar empresa"}
                              >
                                {c.status === "ativa" ? "Suspender" : "Reativar"}
                              </button>
                              <span className="text-xs text-[var(--primary)] font-semibold group-hover:underline flex items-center gap-1">
                                <span>Ver detalhes</span>
                                <span>›</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          ) : activeTab === "backups" ? (
            /* ─── ABA BACKUPS: Select em largura total + botões ──────── */
            <section className="card p-4 sm:p-6 w-full space-y-6">
              <div className="space-y-4 border-b line pb-5">
                <div>
                  <p className="muted text-xs font-semibold uppercase tracking-wider">BACKUPS</p>
                  <h2 className="mt-1 text-xl font-bold">Gerenciamento de backups</h2>
                  <p className="muted mt-1 text-sm">
                    Histórico e geração de backups completos por empresa em formato ZIP
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
                  <div className="flex-1 min-w-0">
                    <select
                      value={backupCompanyId}
                      onChange={(e) => {
                        setBackupCompanyId(e.target.value);
                        loadBackups(e.target.value);
                      }}
                      className="field w-full h-[44px]"
                      aria-label="Empresa para backup"
                    >
                      {companies.length === 0 ? (
                        <option value="">Nenhuma empresa disponível</option>
                      ) : (
                        companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))
                      )}
                    </select>
                    {!backupCompanyId && (
                      <p className="text-xs text-muted mt-1">Escolha uma empresa.</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={handleGenerateBackup}
                      disabled={generatingBackup || !backupCompanyId}
                      className="btn btn-primary agenda-action agenda-new-action h-[44px] px-5"
                      title={!backupCompanyId ? "Escolha uma empresa." : undefined}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      <span>{generatingBackup ? "Gerando backup…" : "Gerar backup"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (backups.length > 0) {
                          void handleDownloadBackup(
                            backups[0].id,
                            backups[0].arquivo.split("/").pop() || `backup-${backups[0].id}.zip`
                          );
                        } else {
                          showWarning("Gere um backup antes de baixar.");
                        }
                      }}
                      disabled={generatingBackup || busy || backups.length === 0}
                      className="btn btn-ghost border line h-[44px] px-5 font-semibold text-[var(--primary)] hover:bg-[var(--hover)] disabled:opacity-50"
                      title={backups.length === 0 ? "Gere um backup antes de baixar." : "Baixar ZIP do backup mais recente"}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      <span>Baixar ZIP</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Lista do histórico de backups */}
              {backupsLoadError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-8 text-center space-y-3">
                  <p className="text-sm font-semibold text-red-400">{backupsLoadError}</p>
                  <button
                    type="button"
                    onClick={() => void loadBackups(backupCompanyId)}
                    className="btn btn-ghost border line text-xs font-medium"
                  >
                    Tentar de novo
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {loadingBackups ? (
                    <div className="p-8 text-center text-sm text-muted">Carregando lista de backups...</div>
                  ) : backups.length === 0 ? (
                    <div className="rounded-xl border border-dashed line p-8 text-center">
                      <p className="font-semibold text-sm">Gere um backup antes de baixar.</p>
                      <p className="muted mt-1 text-xs">
                        Clique em &quot;Gerar backup&quot; acima para criar um pacote dos dados desta empresa.
                      </p>
                    </div>
                  ) : (
                    backups.map((b) => {
                      const sizeKb = (b.tamanho_bytes / 1024).toFixed(1);
                      return (
                        <div
                          key={b.id}
                          className="rounded-xl border line p-4 surface hover:shadow-md transition-all flex items-center justify-between gap-4"
                        >
                          <div>
                            <p className="font-semibold text-sm">
                              {new Intl.DateTimeFormat("pt-BR", {
                                dateStyle: "full",
                                timeStyle: "short",
                              }).format(new Date(b.created_at))}
                            </p>
                            <p className="muted text-xs mt-0.5">
                              {sizeKb} KB · Tipo: {b.tipo}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleStartRestore(b)}
                              disabled={busy || generatingBackup || restoring}
                              className="btn btn-ghost border line text-xs font-semibold px-3 py-1.5 h-auto text-amber-500 hover:text-amber-600 hover:border-amber-500/40 transition-colors"
                              title="Restaurar dados desta empresa a partir deste backup"
                            >
                              Restaurar
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleDownloadBackup(b.id, b.arquivo.split("/").pop() || `backup-${b.id}.zip`)
                              }
                              disabled={busy || generatingBackup || restoring}
                              className="btn btn-ghost text-xs text-[var(--primary)] font-semibold px-3 py-1.5 h-auto"
                            >
                              Baixar ZIP
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          ) : (
            /* ─── ABA AUDITORIA: Registros e Filtros ──────────────────── */
            <section className="card p-4 sm:p-6 w-full space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b line pb-5">
                <div>
                  <h2 className="text-xl font-bold">Auditoria do sistema</h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadAudit(auditPage)}
                    disabled={loadingAudit}
                    className="btn btn-ghost border line text-xs font-semibold px-3 py-2 h-auto"
                  >
                    <svg className={`w-3.5 h-3.5 ${loadingAudit ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    <span>{loadingAudit ? "Atualizando…" : "Atualizar"}</span>
                  </button>
                </div>
              </div>

              {/* Filtros */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                    Empresa
                  </label>
                  <select
                    value={auditFilterCompany}
                    onChange={(e) => {
                      setAuditFilterCompany(e.target.value);
                    }}
                    className="field text-xs !h-10 !py-2 !px-3 cursor-pointer"
                  >
                    <option value="todas">Todas as empresas</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                    Tipo de Ação
                  </label>
                  <select
                    value={auditFilterAction}
                    onChange={(e) => {
                      setAuditFilterAction(e.target.value);
                    }}
                    className="field text-xs !h-10 !py-2 !px-3 cursor-pointer"
                  >
                    <option value="todas">Todas as ações</option>
                    <option value="empresa.suspensa">Empresa suspensa</option>
                    <option value="empresa.reativada">Empresa reativada</option>
                    <option value="empresa.criada">Empresa criada</option>
                    <option value="empresa.atualizada">Empresa atualizada</option>
                    <option value="empresa.excluida">Empresa excluída</option>
                    <option value="membro.convidado">Usuário convidado</option>
                    <option value="membro.criado">Usuário criado (senha provisória)</option>
                    <option value="membro.vinculado">Usuário vinculado</option>
                    <option value="membro.reativado">Usuário reativado</option>
                    <option value="membro.bloqueado">Usuário bloqueado</option>
                    <option value="membro.desbloqueado">Usuário desbloqueado</option>
                    <option value="membro.papel_alterado">Papel alterado</option>
                    <option value="membro.senha_resetada">Senha resetada</option>
                    <option value="membro.removido">Usuário removido</option>
                    <option value="backup.manual_criado">Backup manual</option>
                    <option value="backup.automatico_criado">Backup automático</option>
                    <option value="backup.restaurado">Backup restaurado</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                    Período
                  </label>
                  <select
                    value={auditFilterPeriod}
                    onChange={(e) => {
                      setAuditFilterPeriod(e.target.value);
                    }}
                    className="field text-xs !h-10 !py-2 !px-3 cursor-pointer"
                  >
                    <option value="todos">Todo o período</option>
                    <option value="hoje">Hoje</option>
                    <option value="7d">Últimos 7 dias</option>
                    <option value="30d">Últimos 30 dias</option>
                  </select>
                </div>
              </div>

              {/* Tabela de Auditoria */}
              {auditError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-8 text-center space-y-3">
                  <p className="text-sm font-semibold text-red-400">{auditError}</p>
                  <button
                    type="button"
                    onClick={() => void loadAudit(auditPage)}
                    className="btn btn-ghost border line text-xs font-medium"
                  >
                    Tentar de novo
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {loadingAudit && auditRecords.length === 0 ? (
                    <div className="p-12 text-center text-sm text-muted">Carregando registros de auditoria...</div>
                  ) : auditRecords.length === 0 ? (
                    <div className="rounded-xl border border-dashed line p-12 text-center space-y-2">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--track)] text-muted mb-1">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                      </div>
                      <p className="font-semibold text-sm">Nenhum evento de auditoria encontrado.</p>
                      <p className="muted mt-1 text-xs">
                        Não há registros correspondentes aos filtros selecionados.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border line">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b line bg-[var(--track)]/50 text-muted uppercase tracking-wider text-[11px] font-semibold">
                            <th className="p-3">Data / Hora</th>
                            <th className="p-3">Quem</th>
                            <th className="p-3">Ação</th>
                            <th className="p-3">Empresa</th>
                            <th className="p-3">Detalhes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y line">
                          {auditRecords.map((item) => {
                            const actionInfo = formatAuditAction(item.acao);
                            const formattedDate = new Intl.DateTimeFormat("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            }).format(new Date(item.created_at));

                            return (
                              <tr key={item.id} className="hover:bg-[var(--track)]/30 transition-colors">
                                <td className="p-3 font-mono text-[11px] text-muted whitespace-nowrap">
                                  {formattedDate}
                                </td>
                                <td className="p-3 font-medium whitespace-nowrap">
                                  {item.user_email}
                                </td>
                                <td className="p-3 whitespace-nowrap">
                                  <span
                                    className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide border ${actionInfo.badgeClass}`}
                                  >
                                    {actionInfo.label}
                                  </span>
                                </td>
                                <td className="p-3 font-semibold whitespace-nowrap">
                                  {item.empresa_nome}
                                </td>
                                <td className="p-3 text-muted text-[11px] max-w-xs truncate" title={formatAuditDetails(item.detalhes)}>
                                  {formatAuditDetails(item.detalhes)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Paginação */}
                  {auditTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-3 border-t line text-xs">
                      <p className="text-muted">
                        Página {auditPage} de {auditTotalPages} ({auditTotalRecords} total)
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={auditPage <= 1 || loadingAudit}
                          onClick={() => void loadAudit(auditPage - 1)}
                          className="btn btn-ghost border line text-xs px-3 py-1 disabled:opacity-40"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          disabled={auditPage >= auditTotalPages || loadingAudit}
                          onClick={() => void loadAudit(auditPage + 1)}
                          className="btn btn-ghost border line text-xs px-3 py-1 disabled:opacity-40"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* ─── MODAL DE DETALHES DA EMPRESA ───────────────────────────────── */}
      {selectedCompanyModalOpen && selectedCompany && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) requestCloseCompanyModal();
          }}
        >
          <div
            ref={companyModalRef}
            className="surface card w-full max-w-[720px] max-h-[90vh] flex flex-col rounded-2xl shadow-2xl border line overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Cabeçalho do Modal */}
            <div className="p-5 sm:p-6 border-b line flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-xl font-bold truncate">{selectedCompany.nome}</h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide border ${
                      selectedCompany.status === "ativa"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                    }`}
                  >
                    {selectedCompany.status === "ativa" ? "Ativa" : "Suspensa"}
                  </span>
                </div>
              </div>

              {/* Botão X para fechar */}
              <button
                type="button"
                onClick={requestCloseCompanyModal}
                className="agenda-icon-button shrink-0"
                title="Fechar (Esc)"
                aria-label="Fechar modal"
              >
                ✕
              </button>
            </div>

            {/* Abas Dados | Membros em Pílula + Ações da Empresa à direita */}
            <div className="px-5 sm:px-6 pt-4 shrink-0 flex items-center justify-between gap-3">
              <div className="agenda-views" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={companyTab === "dados"}
                  className={`agenda-tab agenda-view-tab ${
                    companyTab === "dados"
                      ? "!border-[color-mix(in_srgb,var(--border)_85%,transparent)] !bg-[var(--surface)] !text-[var(--primary)] !shadow-[0_1px_3px_rgba(15,23,42,0.1)] font-bold"
                      : ""
                  }`}
                  onClick={() => setCompanyTab("dados")}
                >
                  Dados
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={companyTab === "membros"}
                  className={`agenda-tab agenda-view-tab ${
                    companyTab === "membros"
                      ? "!border-[color-mix(in_srgb,var(--border)_85%,transparent)] !bg-[var(--surface)] !text-[var(--primary)] !shadow-[0_1px_3px_rgba(15,23,42,0.1)] font-bold"
                      : ""
                  }`}
                  onClick={() => setCompanyTab("membros")}
                >
                  Usuários ({members.length})
                </button>
              </div>

              {/* Botão e Menu Ações da Empresa com o design da agenda */}
              <div className="relative" ref={companyMenuRef}>
                <button
                  type="button"
                  onClick={() => setCompanyMenuOpen((open) => !open)}
                  className={`btn border line text-xs font-semibold px-3.5 h-[38px] rounded-xl flex items-center gap-2 transition-all shrink-0 ${
                    companyMenuOpen
                      ? "bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)] shadow-sm"
                      : "btn-ghost hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  }`}
                  aria-expanded={companyMenuOpen}
                  title="Ações da empresa"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  <span>Ações</span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-150 text-muted ${companyMenuOpen ? "rotate-180 text-[var(--primary)]" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {companyMenuOpen && (
                  <div className="agenda-data-dropdown absolute right-0 top-[46px] z-30 min-w-[260px] shadow-2xl animate-in fade-in duration-100">
                    <p className="agenda-data-label">AÇÕES DA EMPRESA</p>

                    {/* Copiar ID */}
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyMenuOpen(false);
                        handleCopyId();
                      }}
                      className="agenda-data-item w-full text-left"
                    >
                      <span className="agenda-data-icon agenda-data-icon-blue">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </span>
                      <span>
                        <strong>Copiar ID</strong>
                        <small>Copiar identificador único</small>
                      </span>
                    </button>

                    {/* Suspender / Reativar */}
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyMenuOpen(false);
                        handleToggleStatus();
                      }}
                      className="agenda-data-item w-full text-left"
                    >
                      <span className={`agenda-data-icon ${selectedCompany.status === "ativa" ? "bg-amber-500/10 text-amber-500" : "agenda-data-icon-blue"}`}>
                        {selectedCompany.status === "ativa" ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                      </span>
                      <span>
                        <strong>{selectedCompany.status === "ativa" ? "Suspender empresa" : "Reativar empresa"}</strong>
                        <small>{selectedCompany.status === "ativa" ? "Bloquear acesso ao app" : "Liberar acesso normal"}</small>
                      </span>
                    </button>

                    {/* Excluir Empresa (apenas Super Admin) */}
                    {isSuperAdmin && (
                      <>
                        <div className="agenda-data-divider" />
                        <button
                          type="button"
                          onClick={() => {
                            setCompanyMenuOpen(false);
                            handleStartDeleteCompany();
                          }}
                          className="agenda-data-item w-full text-left !text-red-500 hover:!bg-red-500/10"
                        >
                          <span className="agenda-data-icon agenda-data-icon-red">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </span>
                          <span>
                            <strong className="text-red-500">Excluir empresa</strong>
                            <small className="text-red-400/80">Apagar dados permanentemente</small>
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Conteúdo rolável */}
            <div className="p-5 sm:p-6 overflow-y-auto flex-1">
              {companyTab === "dados" ? (
                <form onSubmit={handleSaveCompany} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                      Nome da empresa
                    </label>
                    <input
                      ref={editNomeInputRef}
                      type="text"
                      required
                      value={formNome}
                      onChange={(e) => {
                        setFormNome(e.target.value);
                        if (editErrors.nome) setEditErrors((prev) => ({ ...prev, nome: undefined }));
                      }}
                      className={`field ${editErrors.nome ? "!border-red-500 focus:!border-red-500" : ""}`}
                      aria-invalid={Boolean(editErrors.nome)}
                    />
                    {editErrors.nome && (
                      <span className="text-xs text-red-500 mt-1 block font-medium" role="alert" aria-live="polite">
                        {editErrors.nome}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                        Plano
                      </label>
                      <input
                        type="text"
                        required
                        value={formPlano}
                        onChange={(e) => {
                          setFormPlano(e.target.value);
                          if (editErrors.plano) setEditErrors((prev) => ({ ...prev, plano: undefined }));
                        }}
                        className={`field ${editErrors.plano ? "!border-red-500 focus:!border-red-500" : ""}`}
                        aria-invalid={Boolean(editErrors.plano)}
                      />
                      {editErrors.plano && (
                        <span className="text-xs text-red-500 mt-1 block font-medium" role="alert" aria-live="polite">
                          {editErrors.plano}
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                        Vencimento
                      </label>
                      <input
                        type="date"
                        value={formVencimento}
                        onChange={(e) => setFormVencimento(e.target.value)}
                        className="field"
                      />
                      {isPastDueDate && (
                        <span className="text-xs text-amber-400 mt-1 block font-medium" role="status" aria-live="polite">
                          Essa data já passou. A empresa pode ser bloqueada.
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                        Status
                      </label>
                      <select
                        value={formStatus}
                        onChange={(e) => {
                          const next = e.target.value as "ativa" | "suspensa";
                          if (selectedCompany) {
                            handleRequestStatusChange(selectedCompany, next);
                          } else {
                            setFormStatus(next);
                          }
                        }}
                        className="field"
                      >
                        <option value="ativa">Ativa</option>
                        <option value="suspensa">Suspensa</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formNaoSuspender}
                        onChange={(e) => setFormNaoSuspender(e.target.checked)}
                        className="rounded border line h-4 w-4 text-[var(--primary)] focus:ring-[var(--primary)] focus:ring-offset-0 cursor-pointer"
                      />
                      <span className="text-xs font-medium">Não suspender automaticamente após o vencimento</span>
                    </label>
                  </div>

                  <div className="pt-4 flex items-center justify-end gap-3 border-t line mt-6">
                    <button
                      type="button"
                      onClick={requestCloseCompanyModal}
                      className="btn btn-ghost"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={!isDirty || busy}
                      className="btn btn-primary agenda-action agenda-new-action px-6 disabled:opacity-50"
                    >
                      {busy ? "Salvando…" : "Salvar alterações"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="muted text-sm">
                      {members.length} {members.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}
                    </p>

                    <button
                      type="button"
                      onClick={handleOpenAddMember}
                      className="btn btn-primary agenda-action agenda-new-action"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>Convidar usuário</span>
                    </button>
                  </div>

                  {/* Lista de membros */}
                  {membersLoadError ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-8 text-center space-y-3">
                      <p className="text-sm font-semibold text-red-400">{membersLoadError}</p>
                      <button
                        type="button"
                        onClick={() => void loadMembers(selectedCompanyId)}
                        className="btn btn-ghost border line text-xs font-medium"
                      >
                        Tentar de novo
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {loadingMembers ? (
                        <div className="p-8 text-center text-sm text-muted">Carregando usuários...</div>
                      ) : members.length === 0 ? (
                        <div className="rounded-xl border border-dashed line p-10 text-center space-y-3">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--track)] text-muted">
                            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <line x1="19" y1="8" x2="19" y2="14" />
                              <line x1="22" y1="11" x2="16" y2="11" />
                            </svg>
                          </div>
                          <p className="font-semibold text-sm">Esta empresa ainda não possui usuários.</p>
                          <p className="text-xs text-muted max-w-sm mx-auto">
                            Convide novos usuários ou crie contas com senha provisória para dar acesso ao sistema.
                          </p>
                          <button
                            type="button"
                            onClick={handleOpenAddMember}
                            className="btn btn-primary agenda-action agenda-new-action mx-auto"
                          >
                            Convidar usuário
                          </button>
                        </div>
                      ) : (
                        members.map((m) => {
                          const initials = getInitials(m.email);
                          const isSelf = m.user_id === currentUserId || m.email.toLowerCase() === currentUserEmail.toLowerCase();
                          return (
                            <div
                              key={m.user_id}
                              className={`rounded-xl border line p-4 surface hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                                m.status === "bloqueado" ? "opacity-75 bg-[var(--track)]/20" : ""
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`w-10 h-10 shrink-0 rounded-full border line flex items-center justify-center font-bold text-xs ${
                                    m.status === "bloqueado"
                                      ? "bg-red-500/10 text-red-500 border-red-500/20"
                                      : "bg-[var(--track)] text-[var(--primary)]"
                                  }`}
                                >
                                  {initials}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold text-sm text-[var(--text)] break-all" title={m.email}>
                                      {m.email}
                                    </p>
                                    {isSelf && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--primary-soft)] text-[var(--primary)]">
                                        Você
                                      </span>
                                    )}
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide border ${
                                        m.status === "ativo"
                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                          : "bg-red-500/10 text-red-500 border-red-500/30"
                                      }`}
                                    >
                                      {m.status === "ativo" ? "Ativo" : "Bloqueado"}
                                    </span>
                                  </div>
                                  <p className="muted text-xs mt-1">
                                    Último acesso: {formatLastAccess(m.ultimo_acesso)}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap shrink-0 pt-2 md:pt-0 border-t md:border-t-0 line">
                                {/* Seletor de Papel sem corte de texto */}
                                <select
                                  value={m.papel}
                                  disabled={busy || isSelf}
                                  onChange={(e) => void handleChangeMemberRole(m, e.target.value as "usuario" | "admin_empresa")}
                                  className="h-9 px-3 py-1.5 text-xs font-semibold rounded-lg border line surface text-[var(--text)] focus:outline-none focus:border-[var(--primary)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0 min-w-[140px]"
                                  title={isSelf ? "Você não pode alterar o seu próprio papel." : "Alterar papel"}
                                >
                                  <option value="usuario">Usuário</option>
                                  <option value="admin_empresa">Admin da Empresa</option>
                                </select>

                                {/* Dropdown de Ações no design da agenda */}
                                <div
                                  className="relative"
                                  ref={activeMemberMenuId === m.user_id ? memberMenuRef : undefined}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setActiveMemberMenuId(activeMemberMenuId === m.user_id ? null : m.user_id)}
                                    className={`btn border line text-xs font-semibold px-3.5 h-[38px] rounded-xl flex items-center gap-2 transition-all shrink-0 ${
                                      activeMemberMenuId === m.user_id
                                        ? "bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)] shadow-sm"
                                        : "btn-ghost hover:border-[var(--primary)] hover:text-[var(--primary)]"
                                    }`}
                                    aria-expanded={activeMemberMenuId === m.user_id}
                                    title="Ações do usuário"
                                  >
                                    <span>Ações</span>
                                    <svg
                                      className={`w-3.5 h-3.5 transition-transform duration-150 text-muted ${activeMemberMenuId === m.user_id ? "rotate-180 text-[var(--primary)]" : ""}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </button>

                                  {activeMemberMenuId === m.user_id && (
                                    <div className="agenda-data-dropdown absolute right-0 top-[46px] z-30 min-w-[260px] shadow-2xl animate-in fade-in duration-100">
                                      <p className="agenda-data-label">AÇÕES DO USUÁRIO</p>

                                      {/* Resetar Senha */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveMemberMenuId(null);
                                          void handleResetMemberPassword(m);
                                        }}
                                        disabled={busy}
                                        className="agenda-data-item w-full text-left"
                                      >
                                        <span className="agenda-data-icon agenda-data-icon-blue">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                          </svg>
                                        </span>
                                        <span>
                                          <strong>Resetar senha</strong>
                                          <small>Enviar e-mail de redefinição</small>
                                        </span>
                                      </button>

                                      {!isSelf && (
                                        <>
                                          {/* Bloquear / Desbloquear */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveMemberMenuId(null);
                                              void handleToggleMemberStatus(m);
                                            }}
                                            disabled={busy}
                                            className="agenda-data-item w-full text-left"
                                          >
                                            <span className={`agenda-data-icon ${m.status === "ativo" ? "bg-amber-500/10 text-amber-500" : "agenda-data-icon-blue"}`}>
                                              {m.status === "ativo" ? (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                                </svg>
                                              ) : (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                              )}
                                            </span>
                                            <span>
                                              <strong>{m.status === "ativo" ? "Bloquear acesso" : "Desbloquear acesso"}</strong>
                                              <small>{m.status === "ativo" ? "Impedir uso nesta empresa" : "Liberar uso normal"}</small>
                                            </span>
                                          </button>

                                          <div className="agenda-data-divider" />

                                          {/* Remover da Empresa */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveMemberMenuId(null);
                                              handleStartRemoveMember(m);
                                            }}
                                            disabled={busy}
                                            className="agenda-data-item w-full text-left !text-red-500 hover:!bg-red-500/10"
                                          >
                                            <span className="agenda-data-icon agenda-data-icon-red">
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                              </svg>
                                            </span>
                                            <span>
                                              <strong className="text-red-500">Remover da empresa</strong>
                                              <small className="text-red-400/80">Desvincular sem excluir conta</small>
                                            </span>
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE ADICIONAR / CONVIDAR MEMBRO (SOBREPOSTO) ─────────── */}
      {addMemberModalOpen && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddMemberModalOpen(false);
          }}
        >
          <div
            ref={addMemberModalRef}
            className="surface card w-full max-w-md rounded-2xl p-6 shadow-2xl border line animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="mb-4 flex items-center justify-between border-b line pb-3">
              <div>
                <p className="muted text-xs font-semibold uppercase tracking-wider">ACESSO À EMPRESA</p>
                <h3 className="text-lg font-bold">Convidar usuário</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddMemberModalOpen(false)}
                className="agenda-icon-button"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {/* Alternar entre Convite por E-mail e Senha Provisória */}
            <div className="mb-4 flex rounded-xl border line p-1 bg-[var(--track)]/50 gap-1">
              <button
                type="button"
                onClick={() => setInviteMethod("convite")}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  inviteMethod === "convite"
                    ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm font-bold"
                    : "text-muted hover:text-[var(--foreground)]"
                }`}
              >
                Convite por e-mail
              </button>
              <button
                type="button"
                onClick={() => setInviteMethod("senha_provisoria")}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  inviteMethod === "senha_provisoria"
                    ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm font-bold"
                    : "text-muted hover:text-[var(--foreground)]"
                }`}
              >
                Senha provisória
              </button>
            </div>

            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  E-mail do usuário
                </label>
                <input
                  ref={newMemberEmailRef}
                  type="email"
                  required
                  placeholder="usuario@email.com"
                  value={newMemberEmail}
                  onChange={(e) => {
                    setNewMemberEmail(e.target.value);
                    if (memberErrors.email) setMemberErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  className={`field ${memberErrors.email ? "!border-red-500 focus:!border-red-500" : ""}`}
                  aria-invalid={Boolean(memberErrors.email)}
                />
                {memberErrors.email && (
                  <span className="text-xs text-red-500 mt-1 block font-medium" role="alert" aria-live="polite">
                    {memberErrors.email}
                  </span>
                )}
                <span className="text-[11px] text-muted mt-1 block">
                  {inviteMethod === "convite"
                    ? "Se já possuir conta, será apenas vinculado. Se não possuir, receberá um e-mail para ativar o acesso."
                    : "A conta será criada imediatamente e a senha provisória será informada para você passar ao usuário."}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Papel na empresa
                </label>
                <select
                  value={newMemberRole}
                  onChange={(e) => {
                    setNewMemberRole(e.target.value as "usuario" | "admin_empresa");
                    if (memberErrors.papel) setMemberErrors((prev) => ({ ...prev, papel: undefined }));
                  }}
                  className={`field ${memberErrors.papel ? "!border-red-500 focus:!border-red-500" : ""}`}
                  aria-invalid={Boolean(memberErrors.papel)}
                >
                  <option value="usuario">Usuário Comum</option>
                  <option value="admin_empresa">Administrador da Empresa</option>
                </select>
                {memberErrors.papel && (
                  <span className="text-xs text-red-500 mt-1 block font-medium" role="alert" aria-live="polite">
                    {memberErrors.papel}
                  </span>
                )}
              </div>

              {inviteMethod === "senha_provisoria" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                    Senha provisória (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Deixe em branco para gerar automaticamente"
                    value={tempPasswordInput}
                    onChange={(e) => setTempPasswordInput(e.target.value)}
                    className="field text-sm font-mono"
                  />
                  <span className="text-[11px] text-muted mt-1 block">
                    Caso deixe em branco, o sistema gerará uma senha provisória forte automaticamente.
                  </span>
                </div>
              )}

              <div className="pt-4 flex justify-end gap-3 border-t line">
                <button
                  type="button"
                  onClick={() => setAddMemberModalOpen(false)}
                  className="btn btn-ghost"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn btn-primary agenda-action px-6 disabled:opacity-50"
                >
                  {busy
                    ? "Processando…"
                    : inviteMethod === "convite"
                    ? "Enviar convite"
                    : "Criar com senha provisória"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL DE SENHA PROVISÓRIA GERADA ───────────────────────────── */}
      {createdTempPasswordInfo && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="surface card w-full max-w-md rounded-2xl p-6 shadow-2xl border line space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold">Conta criada com sucesso</h3>
                <p className="text-xs text-muted">Acesso gerado para {createdTempPasswordInfo.email}</p>
              </div>
            </div>

            <div className="rounded-xl border line p-4 bg-[var(--track)]/50 space-y-2">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Senha Provisória</p>
              <div className="flex items-center justify-between gap-3 bg-[var(--surface)] p-3 rounded-lg border line">
                <code className="text-base font-bold font-mono text-[var(--primary)] tracking-wider">
                  {createdTempPasswordInfo.password}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(createdTempPasswordInfo.password);
                    showSuccess("Senha copiada para a área de transferência!");
                  }}
                  className="btn btn-ghost border line text-xs font-semibold px-2.5 py-1"
                >
                  Copiar
                </button>
              </div>
              <p className="text-[11px] text-amber-500 font-medium">
                Atenção: Por questões de segurança, esta senha provisória não será exibida novamente após fechar esta janela.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t line">
              <button
                type="button"
                onClick={() => {
                  setCreatedTempPasswordInfo(null);
                  setAddMemberModalOpen(false);
                }}
                className="btn btn-primary px-6"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE LINK DE REDEFINIÇÃO DE SENHA GERADO ───────────────── */}
      {resetPasswordResult && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="surface card w-full max-w-md rounded-2xl p-6 shadow-2xl border line space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <h3 className="text-lg font-bold">Redefinição de senha</h3>
            <p className="text-sm text-muted">
              Um e-mail foi solicitado para <strong>{resetPasswordResult.email}</strong>. Caso necessário, você também pode copiar o link direto abaixo:
            </p>

            {resetPasswordResult.link && (
              <div className="rounded-xl border line p-3.5 bg-[var(--track)]/50 space-y-2">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Link direto de recuperação</p>
                <div className="flex items-center justify-between gap-2 bg-[var(--surface)] p-2.5 rounded-lg border line">
                  <input
                    type="text"
                    readOnly
                    value={resetPasswordResult.link}
                    className="field text-xs bg-transparent border-0 p-0 truncate flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (resetPasswordResult.link) {
                        navigator.clipboard.writeText(resetPasswordResult.link);
                        showSuccess("Link copiado!");
                      }
                    }}
                    className="btn btn-ghost border line text-xs font-semibold px-2.5 py-1 shrink-0"
                  >
                    Copiar
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t line">
              <button
                type="button"
                onClick={() => setResetPasswordResult(null)}
                className="btn btn-primary px-6"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE CADASTRAR NOVA EMPRESA ────────────────────────────── */}
      {createCompanyModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateCompanyModalOpen(false);
          }}
        >
          <div
            ref={createCompanyModalRef}
            className="surface card w-full max-w-[600px] rounded-2xl p-6 shadow-2xl border line flex flex-col animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="mb-5 flex items-center justify-between border-b line pb-4">
              <div>
                <p className="muted text-xs font-semibold uppercase tracking-wider">NOVA EMPRESA</p>
                <h2 className="mt-1 text-xl font-bold">Cadastrar nova empresa</h2>
                <p className="muted mt-1 text-sm">
                  Preencha os dados básicos para registrar a empresa no sistema
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateCompanyModalOpen(false)}
                className="agenda-icon-button"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCompany} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Nome da empresa
                </label>
                <input
                  ref={newNomeInputRef}
                  type="text"
                  required
                  placeholder="Ex: Empresa Exemplo Ltda"
                  value={newCompanyNome}
                  onChange={(e) => {
                    setNewCompanyNome(e.target.value);
                    if (newCompanyErrors.nome) setNewCompanyErrors((prev) => ({ ...prev, nome: undefined }));
                  }}
                  className={`field ${newCompanyErrors.nome ? "!border-red-500 focus:!border-red-500" : ""}`}
                  aria-invalid={Boolean(newCompanyErrors.nome)}
                />
                {newCompanyErrors.nome && (
                  <span className="text-xs text-red-500 mt-1 block font-medium" role="alert" aria-live="polite">
                    {newCompanyErrors.nome}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                    Plano
                  </label>
                  <input
                    type="text"
                    required
                    value={newCompanyPlano}
                    onChange={(e) => {
                      setNewCompanyPlano(e.target.value);
                      if (newCompanyErrors.plano) setNewCompanyErrors((prev) => ({ ...prev, plano: undefined }));
                    }}
                    placeholder="Padrão"
                    className={`field ${newCompanyErrors.plano ? "!border-red-500 focus:!border-red-500" : ""}`}
                    aria-invalid={Boolean(newCompanyErrors.plano)}
                  />
                  {newCompanyErrors.plano && (
                    <span className="text-xs text-red-500 mt-1 block font-medium" role="alert" aria-live="polite">
                      {newCompanyErrors.plano}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                    Vencimento
                  </label>
                  <input
                    type="date"
                    value={newCompanyVencimento}
                    onChange={(e) => setNewCompanyVencimento(e.target.value)}
                    className="field"
                  />
                  {isNewPastDueDate && (
                    <span className="text-xs text-amber-400 mt-1 block font-medium" role="status" aria-live="polite">
                      Essa data já passou. A empresa pode ser bloqueada.
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newCompanyNaoSuspender}
                    onChange={(e) => setNewCompanyNaoSuspender(e.target.checked)}
                    className="rounded border line h-4 w-4 text-[var(--primary)] focus:ring-[var(--primary)] focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="text-xs font-medium">Não suspender automaticamente após o vencimento</span>
                </label>
              </div>

              {/* Rodapé: único botão Cancelar */}
              <div className="pt-4 flex justify-end gap-3 border-t line mt-2">
                <button
                  type="button"
                  onClick={() => setCreateCompanyModalOpen(false)}
                  className="btn btn-ghost"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn btn-primary agenda-action agenda-new-action px-6 disabled:opacity-50"
                >
                  {busy ? "Salvando…" : "Cadastrar empresa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL DE CONFIRMAÇÃO: DESCARTAR ALTERAÇÕES ─────────────────── */}
      {discardConfirmOpen && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="surface card w-full max-w-sm rounded-2xl p-6 shadow-2xl border line space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <h3 className="text-lg font-bold">Descartar alterações?</h3>
            <p className="text-sm text-muted">
              Você possui alterações não salvas. Se sair agora, as modificações serão perdidas.
            </p>
            <div className="flex justify-end gap-2.5 pt-2 border-t line">
              <button
                type="button"
                onClick={() => setDiscardConfirmOpen(false)}
                className="btn btn-ghost text-xs"
              >
                Continuar editando
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscardConfirmOpen(false);
                  if (pendingDiscardAction) pendingDiscardAction();
                }}
                className="btn btn-primary text-xs !bg-red-600 hover:!bg-red-700"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE CONFIRMAÇÃO: SUSPENDER / REATIVAR EMPRESA ─────────── */}
      {statusConfirmTarget && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="surface card w-full max-w-md rounded-2xl p-6 shadow-2xl border line space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <h3 className="text-lg font-bold">
              {statusConfirmTarget.nextStatus === "suspensa" ? "Suspender empresa" : "Reativar empresa"}
            </h3>
            <p className="text-sm text-muted leading-relaxed">
              {statusConfirmTarget.nextStatus === "suspensa" ? (
                <>
                  Tem certeza que deseja suspender a empresa{" "}
                  <strong className="text-[var(--foreground)]">{statusConfirmTarget.company.nome}</strong>?
                  {" "}Os membros desta empresa perderão o acesso ao sistema até que ela seja reativada.
                </>
              ) : (
                <>
                  Tem certeza que deseja reativar a empresa{" "}
                  <strong className="text-[var(--foreground)]">{statusConfirmTarget.company.nome}</strong>?
                  {" "}O acesso ao sistema será liberado novamente para os membros desta empresa.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2.5 pt-2 border-t line">
              <button
                type="button"
                onClick={() => setStatusConfirmTarget(null)}
                disabled={busy}
                className="btn btn-ghost text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void executeStatusChange(statusConfirmTarget.company, statusConfirmTarget.nextStatus)}
                disabled={busy}
                className={`btn btn-primary text-xs ${
                  statusConfirmTarget.nextStatus === "suspensa"
                    ? "!bg-rose-600 hover:!bg-rose-700 !border-rose-600"
                    : ""
                }`}
              >
                {busy
                  ? statusConfirmTarget.nextStatus === "suspensa"
                    ? "Suspendendo…"
                    : "Reativando…"
                  : statusConfirmTarget.nextStatus === "suspensa"
                  ? "Suspender empresa"
                  : "Reativar empresa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE CONFIRMAÇÃO: EXCLUIR EMPRESA (DIGITANDO NOME) ────── */}
      {deleteConfirmOpen && selectedCompany && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="surface card w-full max-w-md rounded-2xl p-6 shadow-2xl border line space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b line pb-3">
              <h3 className="text-lg font-bold text-red-500">Excluir empresa</h3>
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                className="agenda-icon-button"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-muted leading-relaxed">
              Essa ação não pode ser desfeita. Digite o nome da empresa para confirmar.
            </p>

            <div className="p-3 rounded-lg bg-[var(--track)] border line select-text font-bold text-sm text-[var(--text)]">
              {selectedCompany.nome}
            </div>

            <div>
              <input
                ref={deleteNameInputRef}
                type="text"
                placeholder="Digite o nome da empresa exatamente como acima"
                value={deleteTypedName}
                onChange={(e) => setDeleteTypedName(e.target.value)}
                className="field text-sm"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t line">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                className="btn btn-ghost text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || deleteTypedName.trim() !== selectedCompany.nome.trim()}
                onClick={() => void executeDeleteCompany()}
                className="btn btn-primary text-xs !bg-red-600 hover:!bg-red-700 disabled:opacity-40"
              >
                {busy ? "Excluindo…" : "Excluir empresa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE CONFIRMAÇÃO: REMOVER MEMBRO ───────────────────────── */}
      {removeMemberConfirm && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="surface card w-full max-w-sm rounded-2xl p-6 shadow-2xl border line space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <h3 className="text-lg font-bold">Remover membro</h3>
            <p className="text-sm text-muted">
              Remover <strong className="text-[var(--text)]">{removeMemberConfirm.email}</strong> da empresa?
            </p>
            <div className="flex justify-end gap-2.5 pt-2 border-t line">
              <button
                type="button"
                onClick={() => setRemoveMemberConfirm(null)}
                className="btn btn-ghost text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void executeRemoveMember()}
                disabled={busy}
                className="btn btn-primary text-xs !bg-red-600 hover:!bg-red-700"
              >
                {busy ? "Removendo…" : "Remover"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE CONFIRMAÇÃO: RESTAURAR BACKUP (DIGITANDO NOME) ───── */}
      {restoreConfirmBackup && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="surface card w-full max-w-md rounded-2xl p-6 shadow-2xl border line space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold">Restaurar backup</h3>
                <p className="text-xs text-muted">Substituição segura dos dados da empresa</p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 text-xs text-amber-300 space-y-1.5">
              <p className="font-semibold">Atenção: Ação de substituição de dados</p>
              <p className="leading-relaxed text-amber-200/80">
                Os dados atuais da empresa <strong>{companies.find((c) => c.id === backupCompanyId)?.nome}</strong> serão substituídos pelos registros deste backup de{" "}
                <strong>
                  {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(restoreConfirmBackup.created_at))}
                </strong>.
              </p>
              <p className="text-[11px] text-amber-400">
                Um backup de segurança automático pré-restauração (tipo <strong>pre_restauracao</strong>) será gerado imediatamente antes.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                Digite o nome exato da empresa para confirmar:
              </label>
              <p className="text-xs font-mono select-all bg-[var(--track)]/50 p-2 rounded-lg border line mb-2 text-center font-bold">
                {companies.find((c) => c.id === backupCompanyId)?.nome}
              </p>
              <input
                ref={restoreNameInputRef}
                type="text"
                autoComplete="off"
                placeholder="Digite o nome da empresa aqui"
                value={restoreTypedName}
                onChange={(e) => setRestoreTypedName(e.target.value)}
                className="field text-sm"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t line">
              <button
                type="button"
                onClick={() => {
                  setRestoreConfirmBackup(null);
                  setRestoreTypedName("");
                }}
                disabled={restoring}
                className="btn btn-ghost text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={
                  restoring ||
                  restoreTypedName.trim() !== (companies.find((c) => c.id === backupCompanyId)?.nome || "").trim()
                }
                className="btn btn-primary text-xs !bg-amber-600 hover:!bg-amber-700 !border-amber-600 disabled:opacity-40"
              >
                {restoring ? "Restaurando…" : "Restaurar dados"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast Flutuante Padronizado ────────────────────────────────── */}
      {toast && (
        <aside
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-[150] flex items-center gap-3 rounded-2xl px-5 py-3 text-sm text-white shadow-2xl animate-in fade-in duration-150 ${
            toast.type === "error"
              ? "bg-red-600"
              : toast.type === "warning"
              ? "bg-amber-600"
              : "bg-emerald-600"
          }`}
        >
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="bg-white/20 hover:bg-white/30 text-white font-semibold rounded-lg px-2.5 py-1 text-xs transition-colors"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="opacity-80 hover:opacity-100 text-xs font-bold ml-1"
            aria-label="Fechar notificação"
          >
            ✕
          </button>
        </aside>
      )}
    </div>
  );
}
