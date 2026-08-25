import { UpdateProfileInputSchema, type Profile, type UpdateProfileInput } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";
import type { ProfileClientLike } from "./index";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ProfileForm = Pick<UpdateProfileInput, "display_name" | "biography" | "locale" | "timezone">;

const emptyForm: ProfileForm = { display_name: "", biography: "", locale: "", timezone: "" };

function formFromProfile(profile: Profile): ProfileForm {
  return {
    display_name: profile.display_name,
    biography: profile.biography,
    locale: profile.locale,
    timezone: profile.timezone,
  };
}

function sameForm(left: ProfileForm, right: ProfileForm) {
  return left.display_name === right.display_name
    && left.biography === right.biography
    && left.locale === right.locale
    && left.timezone === right.timezone;
}

function avatarUrl(profile: Profile | null) {
  if (!profile?.avatar_url) return null;
  const separator = profile.avatar_url.includes("?") ? "&" : "?";
  return `${profile.avatar_url}${separator}v=${encodeURIComponent(profile.updated_at)}`;
}

export interface ProfilePanelProps {
  client: ProfileClientLike;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  onRetry(): void;
  onProfileChange(profile: Profile): void;
}

export function ProfilePanel({ client, profile, loading, error, onRetry, onProfileChange }: ProfilePanelProps) {
  const [form, setForm] = useState<ProfileForm>(() => profile ? formFromProfile(profile) : emptyForm);
  const formRef = useRef<ProfileForm>(profile ? formFromProfile(profile) : emptyForm);
  const editRevisionRef = useRef(0);
  const baselineRef = useRef<ProfileForm>(profile ? formFromProfile(profile) : emptyForm);
  const baselineProfileIdRef = useRef<string | null>(profile?.id ?? null);
  const profileIdRef = useRef<string | null>(profile?.id ?? null);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarPending, setAvatarPending] = useState<"upload" | "delete" | null>(null);
  const [profilePending, setProfilePending] = useState(false);

  const dirty = !sameForm(form, baselineRef.current);
  dirtyRef.current = dirty;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const next = formFromProfile(profile);
    const profileChanged = baselineProfileIdRef.current !== null && baselineProfileIdRef.current !== profile.id;
    profileIdRef.current = profile.id;
    if (profileChanged || !dirtyRef.current) {
      baselineProfileIdRef.current = profile.id;
      baselineRef.current = next;
      formRef.current = next;
      setForm(next);
      setFormError(null);
    }
  }, [dirty, profile]);

  const updateField = (field: keyof ProfileForm, value: string) => {
    const next = { ...form, [field]: value };
    dirtyRef.current = !sameForm(next, baselineRef.current);
    editRevisionRef.current += 1;
    formRef.current = next;
    setForm(next);
    setFormError(null);
  };

  const saveProfile = () => {
    if (!profile || loading || profilePending) return;
    const parsed = UpdateProfileInputSchema.safeParse(form);
    if (!parsed.success) {
      setFormError("个人资料格式无效，请检查昵称、语言和时区。");
      return;
    }
    setProfilePending(true);
    setFormError(null);
    const profileId = profileIdRef.current;
    const submitRevision = editRevisionRef.current;
    void Promise.resolve().then(() => client.updateProfile(parsed.data)).then((next) => {
      if (!mountedRef.current || profileIdRef.current !== profileId) return;
      const nextForm = formFromProfile(next);
      baselineProfileIdRef.current = next.id;
      baselineRef.current = nextForm;
      dirtyRef.current = false;
      const changedSinceSubmit = editRevisionRef.current !== submitRevision;
      if (!changedSinceSubmit) {
        formRef.current = nextForm;
        setForm(nextForm);
      }
      dirtyRef.current = !sameForm(formRef.current, nextForm);
      onProfileChange(next);
    }).catch(() => {
      if (mountedRef.current && profileIdRef.current === profileId) setFormError("保存失败，请稍后重试。");
    }).finally(() => {
      if (mountedRef.current) setProfilePending(false);
    });
  };

  const chooseAvatar = (file: File | null) => {
    setAvatarError(null);
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type)) {
      setSelectedFile(null);
      setAvatarError("仅支持 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size < 1 || file.size > MAX_AVATAR_BYTES) {
      setSelectedFile(null);
      setAvatarError(file.size > MAX_AVATAR_BYTES ? "头像大小必须不超过 2 MiB。" : "头像不能为空。");
      return;
    }
    setSelectedFile(file);
  };

  const uploadAvatar = () => {
    if (!selectedFile || avatarPending) return;
    setAvatarPending("upload");
    setAvatarError(null);
    const file = selectedFile;
    const profileId = profileIdRef.current;
    void Promise.resolve().then(() => client.uploadAvatar(file)).then((next) => {
      if (!mountedRef.current || profileIdRef.current !== profileId) return;
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onProfileChange(next);
    }).catch(() => {
      if (mountedRef.current && profileIdRef.current === profileId) setAvatarError("头像上传失败，请重试。");
    }).finally(() => {
      if (mountedRef.current) setAvatarPending(null);
    });
  };

  const deleteAvatar = () => {
    if (avatarPending) return;
    setAvatarPending("delete");
    setAvatarError(null);
    const profileId = profileIdRef.current;
    void Promise.resolve().then(() => client.deleteAvatar()).then((next) => {
      if (!mountedRef.current || profileIdRef.current !== profileId) return;
      onProfileChange(next);
    }).catch(() => {
      if (mountedRef.current && profileIdRef.current === profileId) setAvatarError("头像删除失败，请重试。");
    }).finally(() => {
      if (mountedRef.current) setAvatarPending(null);
    });
  };

  return (
    <section id="account-panel-profile" role="tabpanel" aria-labelledby="account-tab-profile" className="account-panel">
      <div className="account-panel-heading">
        <div><p className="eyebrow">PROFILE</p><h2>个人资料</h2><p>管理账户身份和显示偏好。</p></div>
        {profile?.avatar_url ? <img className="profile-avatar-preview" src={avatarUrl(profile) ?? undefined} alt={`${profile.display_name || profile.email} 的头像`} /> : <div className="profile-avatar-fallback" aria-hidden="true">{(form.display_name || profile?.email || "N").slice(0, 1).toUpperCase()}</div>}
      </div>
      {loading ? <p className="account-inline-status" role="status" aria-label="正在加载个人资料">正在加载个人资料…</p> : null}
      {error ? <div className="account-error-row"><p role="alert">个人资料加载失败，请重试。</p><button type="button" onClick={onRetry}>重试个人资料加载</button></div> : null}
      {formError ? <p className="account-error" role="alert">{formError}</p> : null}
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); saveProfile(); }}>
        <label>昵称<input value={form.display_name} onChange={(event) => updateField("display_name", event.target.value)} /></label>
        <label>个人简介<textarea value={form.biography} onChange={(event) => updateField("biography", event.target.value)} /></label>
        <div className="account-form-grid"><label>语言<input value={form.locale} onChange={(event) => updateField("locale", event.target.value)} /></label><label>时区<input value={form.timezone} onChange={(event) => updateField("timezone", event.target.value)} /></label></div>
        <button type="submit" disabled={loading || !profile || profilePending}>{profilePending ? "正在保存…" : "保存个人资料"}</button>
      </form>
      <section className="account-subpanel" aria-labelledby="avatar-heading">
        <h3 id="avatar-heading">头像</h3>
        <label>头像文件<input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0] ?? null)} /></label>
        {selectedFile ? <p className="account-file-name">已选择：{selectedFile.name}</p> : null}
        {avatarError ? <p className="account-error" role="alert">{avatarError}</p> : null}
        <div className="account-actions"><button type="button" disabled={!selectedFile || avatarPending !== null} onClick={uploadAvatar}>{avatarPending === "upload" ? "正在上传…" : "上传头像"}</button><button type="button" disabled={!profile?.avatar_url || avatarPending !== null} onClick={deleteAvatar}>{avatarPending === "delete" ? "正在删除…" : "删除头像"}</button></div>
      </section>
    </section>
  );
}
