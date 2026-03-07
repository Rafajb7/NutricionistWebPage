"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  LogOut,
  Plus,
  Search,
  Shield,
  Trash2,
  UsersRound
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";

type SessionUser = {
  username: string;
  name: string;
};

type AdminToolsShellProps = {
  user: SessionUser;
};

type AdminUser = {
  username: string;
  name: string;
  email: string;
  permission: "user" | "admin";
};

type AdminCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  createdAt: string;
  username: string | null;
  displayName: string | null;
};

type ActiveTool = "users" | "calendar";

function formatEventDate(value: string): string {
  if (!value) return "Sin fecha";

  const hasTime = value.includes("T");
  const parsed = hasTime ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return hasTime
    ? parsed.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : parsed.toLocaleDateString("es-ES");
}

function toDefaultDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AdminToolsShell({ user }: AdminToolsShellProps) {
  const [activeTool, setActiveTool] = useState<ActiveTool>("users");

  const [usersLoading, setUsersLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersFilter, setUsersFilter] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [deletingUsername, setDeletingUsername] = useState<string | null>(null);

  const [newUserName, setNewUserName] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPermission, setNewUserPermission] = useState<"user" | "admin">("user");

  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarEvents, setCalendarEvents] = useState<AdminCalendarEvent[]>([]);
  const [calendarEmbedUrl, setCalendarEmbedUrl] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);

  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState(toDefaultDate);
  const [eventTime, setEventTime] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventUsername, setEventUsername] = useState("");

  const filteredUsers = useMemo(() => {
    const q = usersFilter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q)
    );
  }, [users, usersFilter]);

  const usersByUsername = useMemo(() => {
    const map = new Map<string, AdminUser>();
    users.forEach((item) => {
      map.set(item.username, item);
    });
    return map;
  }, [users]);

  async function loadUsers() {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        window.location.href = "/dashboard";
        return;
      }

      const json = (await res.json()) as { users?: AdminUser[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar usuarios.");
      setUsers(json.users ?? []);
    } catch (error) {
      console.error(error);
      toast.error("Error cargando usuarios.");
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadCalendar() {
    try {
      const res = await fetch("/api/admin/calendar");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        window.location.href = "/dashboard";
        return;
      }

      const json = (await res.json()) as {
        events?: AdminCalendarEvent[];
        embedUrl?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar el calendario.");
      setCalendarEvents(json.events ?? []);
      setCalendarEmbedUrl(json.embedUrl ?? "");
    } catch (error) {
      console.error(error);
      toast.error("Error cargando calendario.");
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadUsers(), loadCalendar()]);
  }, []);

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  async function handleCreateUser() {
    if (!newUserName.trim() || !newUserUsername.trim() || !newUserPassword.trim()) {
      toast.error("Nombre, usuario y contraseña son obligatorios.");
      return;
    }

    setCreatingUser(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName,
          username: newUserUsername,
          email: newUserEmail || undefined,
          password: newUserPassword,
          permission: newUserPermission
        })
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        return;
      }

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo crear el usuario.");
        return;
      }

      toast.success("Usuario creado.");
      setNewUserName("");
      setNewUserUsername("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserPermission("user");
      await loadUsers();
    } catch (error) {
      console.error(error);
      toast.error("Error creando usuario.");
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleDeleteUser(username: string) {
    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar al usuario "${username}"? Esta accion no se puede deshacer.`
    );
    if (!confirmed) return;

    setDeletingUsername(username);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        return;
      }

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo eliminar el usuario.");
        return;
      }

      toast.success("Usuario eliminado.");
      await loadUsers();
    } catch (error) {
      console.error(error);
      toast.error("Error eliminando usuario.");
    } finally {
      setDeletingUsername(null);
    }
  }

  async function handleCreateEvent() {
    if (!eventTitle.trim() || !eventDate.trim()) {
      toast.error("Titulo y fecha son obligatorios.");
      return;
    }

    setCreatingEvent(true);
    try {
      const selectedUser = eventUsername ? usersByUsername.get(eventUsername) : null;
      const res = await fetch("/api/admin/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: eventTitle,
          date: eventDate,
          time: eventTime || undefined,
          location: eventLocation || undefined,
          description: eventDescription || undefined,
          username: selectedUser?.username || undefined,
          displayName: selectedUser?.name || undefined
        })
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        return;
      }

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo crear el evento.");
        return;
      }

      toast.success("Evento creado en Google Calendar.");
      setEventTitle("");
      setEventTime("");
      setEventLocation("");
      setEventDescription("");
      setEventUsername("");
      await loadCalendar();
    } catch (error) {
      console.error(error);
      toast.error("Error creando evento.");
    } finally {
      setCreatingEvent(false);
    }
  }

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 md:px-8">
        <header className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <BrandLogo />
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Link href="/dashboard">
                  <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                    Dashboard
                  </BrandButton>
                </Link>
                <Link href="/tools">
                  <BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">
                    Herramientas admin
                  </BrandButton>
                </Link>
                <Link href="/community">
                  <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                    Comunidad
                  </BrandButton>
                </Link>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Administrador</p>
                <p className="font-semibold text-brand-text">{user.name}</p>
              </div>
              <BrandButton
                variant="ghost"
                className="w-full justify-center px-4 py-2 sm:w-auto"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </BrandButton>
            </div>
          </div>
        </header>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-brand-accent/25 bg-brand-surface p-6 shadow-glow"
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTool("users")}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition ${
                activeTool === "users"
                  ? "border-brand-accent/50 bg-brand-accent/10 text-brand-text"
                  : "border-white/20 text-brand-muted hover:bg-white/10"
              }`}
            >
              <UsersRound className="h-4 w-4" />
              Control de usuarios
            </button>
            <button
              type="button"
              onClick={() => setActiveTool("calendar")}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition ${
                activeTool === "calendar"
                  ? "border-brand-accent/50 bg-brand-accent/10 text-brand-text"
                  : "border-white/20 text-brand-muted hover:bg-white/10"
              }`}
            >
              <CalendarDays className="h-4 w-4" />
              Calendario
            </button>
            <span className="inline-flex items-center gap-2 rounded-xl border border-brand-accent/35 bg-brand-accent/10 px-3 py-2 text-xs text-brand-text">
              <Shield className="h-4 w-4" />
              Herramientas exclusivas de admin
            </span>
          </div>
        </motion.section>

        {activeTool === "users" ? (
          <section className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <h2 className="text-lg font-semibold text-brand-text">Usuarios</h2>
                  <label className="relative min-w-0 w-full max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                    <input
                      value={usersFilter}
                      onChange={(event) => setUsersFilter(event.target.value)}
                      placeholder="Buscar por nombre, usuario o email"
                      className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                </div>

                {usersLoading ? (
                  <div className="mt-4 space-y-2">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))}
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <p className="mt-4 text-sm text-brand-muted">No hay usuarios para este filtro.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                    <table className="min-w-[760px] w-full text-sm">
                      <thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted">
                        <tr>
                          <th className="px-3 py-2 text-left">Nombre</th>
                          <th className="px-3 py-2 text-left">Usuario</th>
                          <th className="px-3 py-2 text-left">Email</th>
                          <th className="px-3 py-2 text-left">Permiso</th>
                          <th className="px-3 py-2 text-left">Accion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((item) => (
                          <tr key={item.username} className="border-t border-white/10">
                            <td className="px-3 py-2 text-brand-text">{item.name}</td>
                            <td className="px-3 py-2 text-brand-text">{item.username}</td>
                            <td className="px-3 py-2 text-brand-muted">{item.email || "-"}</td>
                            <td className="px-3 py-2 text-brand-text">{item.permission}</td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(item.username)}
                                disabled={
                                  deletingUsername === item.username || item.username === user.username
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {deletingUsername === item.username ? "Eliminando..." : "Eliminar"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h2 className="text-lg font-semibold text-brand-text">Nuevo usuario</h2>
                <div className="mt-3 space-y-3">
                  <label className="block text-sm text-brand-muted">
                    Nombre
                    <input
                      value={newUserName}
                      onChange={(event) => setNewUserName(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Usuario
                    <input
                      value={newUserUsername}
                      onChange={(event) => setNewUserUsername(event.target.value)}
                      placeholder="ejemplo: manolohm"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Email
                    <input
                      value={newUserEmail}
                      onChange={(event) => setNewUserEmail(event.target.value)}
                      type="email"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Contraseña inicial
                    <input
                      value={newUserPassword}
                      onChange={(event) => setNewUserPassword(event.target.value)}
                      type="password"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Permiso
                    <select
                      value={newUserPermission}
                      onChange={(event) =>
                        setNewUserPermission(event.target.value as "user" | "admin")
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>
                  <BrandButton onClick={handleCreateUser} disabled={creatingUser} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    {creatingUser ? "Creando..." : "Crear usuario"}
                  </BrandButton>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <h2 className="text-lg font-semibold text-brand-text">Registrar evento</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block text-sm text-brand-muted">
                  Titulo
                  <input
                    value={eventTitle}
                    onChange={(event) => setEventTitle(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <label className="block text-sm text-brand-muted">
                  Fecha
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(event) => setEventDate(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <label className="block text-sm text-brand-muted">
                  Hora (opcional)
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(event) => setEventTime(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <label className="block text-sm text-brand-muted">
                  Cliente (opcional)
                  <select
                    value={eventUsername}
                    onChange={(event) => setEventUsername(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  >
                    <option value="">Sin cliente asociado</option>
                    {users.map((item) => (
                      <option key={item.username} value={item.username}>
                        {item.name} ({item.username})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-brand-muted md:col-span-2">
                  Ubicacion (opcional)
                  <input
                    value={eventLocation}
                    onChange={(event) => setEventLocation(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <label className="block text-sm text-brand-muted md:col-span-2">
                  Descripcion (opcional)
                  <textarea
                    value={eventDescription}
                    onChange={(event) => setEventDescription(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
              </div>
              <div className="mt-3">
                <BrandButton onClick={handleCreateEvent} disabled={creatingEvent}>
                  <Plus className="mr-2 h-4 w-4" />
                  {creatingEvent ? "Creando evento..." : "Crear evento en Google Calendar"}
                </BrandButton>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h2 className="text-lg font-semibold text-brand-text">Calendario actual</h2>
                {calendarLoading ? (
                  <div className="mt-4">
                    <Skeleton className="h-[520px] w-full rounded-xl" />
                  </div>
                ) : calendarEmbedUrl ? (
                  <iframe
                    title="Google Calendar"
                    src={calendarEmbedUrl}
                    className="mt-4 h-[520px] w-full rounded-xl border border-white/10 bg-white"
                  />
                ) : (
                  <p className="mt-4 text-sm text-brand-muted">
                    No se pudo generar la vista embebida del calendario.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h2 className="text-lg font-semibold text-brand-text">Eventos registrados</h2>
                {calendarLoading ? (
                  <div className="mt-3 space-y-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <Skeleton key={index} className="h-14 w-full" />
                    ))}
                  </div>
                ) : calendarEvents.length === 0 ? (
                  <p className="mt-3 text-sm text-brand-muted">No hay eventos para el rango actual.</p>
                ) : (
                  <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
                    {calendarEvents.map((event) => (
                      <article key={event.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                        <p className="text-sm font-semibold text-brand-text">{event.title}</p>
                        <p className="mt-1 text-xs text-brand-muted">{formatEventDate(event.start)}</p>
                        {event.username ? (
                          <p className="mt-1 text-xs text-brand-muted">
                            Cliente: {event.displayName ?? event.username} ({event.username})
                          </p>
                        ) : null}
                        {event.location ? (
                          <p className="mt-1 text-xs text-brand-muted">Ubicacion: {event.location}</p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </MotionPage>
  );
}

