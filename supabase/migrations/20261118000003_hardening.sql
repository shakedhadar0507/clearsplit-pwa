-- Security advisor fixes: pin search_path on remaining functions, hide trigger function from the API.
revoke execute on function public._handle_auth_user_email_change() from public, anon, authenticated;
alter function public._err(text) set search_path = public;
alter function public._profiles_guard() set search_path = public;
alter function public._groups_guard() set search_path = public;
