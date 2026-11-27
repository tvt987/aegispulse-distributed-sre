# Stage 1: Restore, Build & Publish AegisPulse .NET 10 API
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY AegisPulse.sln ./
COPY src/AegisPulse.Domain/AegisPulse.Domain.csproj src/AegisPulse.Domain/
COPY src/AegisPulse.Api/AegisPulse.Api.csproj src/AegisPulse.Api/
RUN dotnet restore src/AegisPulse.Api/AegisPulse.Api.csproj

COPY src/ src/
RUN dotnet publish src/AegisPulse.Api/AegisPulse.Api.csproj -c Release -o /app/publish --no-restore

# Stage 2: Minimal Non-Root ASP.NET Core 10 Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish ./

ENV ASPNETCORE_URLS=http://+:5080
ENV DOTNET_EnableDiagnostics=0
EXPOSE 5080

USER $APP_UID

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/5080 && printf "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3 && grep -q "200 OK" <&3' || exit 1

ENTRYPOINT ["dotnet", "AegisPulse.Api.dll"]
