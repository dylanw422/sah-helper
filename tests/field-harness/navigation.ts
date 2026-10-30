export const useParams = () => ({ id: "client-demo", token: "isolated-project-link" });
export const useRouter = () => ({ replace: (path: string) => { window.location.href = path; }, push: (path: string) => { window.location.href = path; }, refresh: () => {} });
