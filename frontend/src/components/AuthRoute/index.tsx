import fetcher from '@src/util/fetcher'
import React, { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import useSWR from 'swr'

interface IAuthRoute {
  Component: () => ReactElement
}
const AuthRoute = ({ Component }: IAuthRoute) => {
  const { data: isLoggined } = useSWR<boolean>('/users', fetcher, { revalidateOnFocus: false })
  if (isLoggined === undefined) return <></>
  return isLoggined ? <Component /> : <Navigate to="/Signin" />
}

export default AuthRoute
